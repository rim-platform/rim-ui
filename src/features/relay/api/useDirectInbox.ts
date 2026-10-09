/**
 * The DMs and groups of every direct space this account uses, as one list: this relay's direct
 * space and those of other relays where someone started a conversation with this person. A
 * conversation continued elsewhere (a successor naming it as predecessor) is shown once, as its
 * successor; of two successors of one conversation the one with the smaller id is canonical.
 */

import { useEffect, useMemo } from "react";
import { useQueries } from "@tanstack/react-query";

import { logger } from "../../../core/logger";
import { queryKeys } from "../../../core/query/keys";
import { leaveConversation } from "../../conversations/api/useChannelMembership";
import { fetchInboxConversations } from "../../conversations/api/useInboxConversations";
import type { ConversationSummary } from "../../conversations/types";
import { useRelayStore } from "../state/useRelayStore";
import { fetchConversationPredecessor, type PredecessorView } from "./relayApi";

/** The direct spaces this account uses: this relay's first, then those on other relays. */
export function useDirectSpaceIds(): string[] {
  const directSpaceId = useRelayStore((s) => s.info?.directSpaceId ?? null);
  const spaces = useRelayStore((s) => s.spaces);
  const forked = useRelayStore((s) => s.forked);
  return useMemo(() => {
    const remote = Object.values(spaces)
      .filter((s) => s.kind === "direct" && !forked.includes(s.hostServerId))
      .map((s) => s.spaceId)
      .sort();
    return directSpaceId ? [directSpaceId, ...remote] : remote;
  }, [directSpaceId, spaces, forked]);
}

/** A conversation's predecessor as `host|conversation id`, the key successors are matched by. */
function predecessorKey(view: PredecessorView | undefined): string | null {
  return view?.predecessor
    ? `${view.predecessor.hostServerId}|${view.predecessor.conversationId}`
    : null;
}

/**
 * Which conversations to hide: predecessors that have a successor in the list, and successors
 * that are not canonical (another successor of the same conversation has a smaller id).
 * `hostOf` gives the host of a space (`null`: this relay, whose id is `relayId`).
 */
export function supersededConversations(
  items: readonly ConversationSummary[],
  predecessors: ReadonlyMap<string, PredecessorView>,
  hostOf: (spaceId: string) => string | null,
  relayId: string | null,
): { hidden: Set<string>; nonCanonical: ConversationSummary[] } {
  const bySource = new Map<string, ConversationSummary[]>();
  for (const item of items) {
    const key = predecessorKey(predecessors.get(item.id));
    if (key) bySource.set(key, [...(bySource.get(key) ?? []), item]);
  }
  const hidden = new Set<string>();
  const nonCanonical: ConversationSummary[] = [];
  for (const item of items) {
    const host = hostOf(item.serverId) ?? relayId;
    if (host && bySource.has(`${host}|${item.id}`)) hidden.add(item.id);
  }
  for (const successors of bySource.values()) {
    const [, ...others] = [...successors].sort((a, b) => a.id.localeCompare(b.id));
    for (const other of others) {
      hidden.add(other.id);
      nonCanonical.push(other);
    }
  }
  return { hidden, nonCanonical };
}

const leftNonCanonical = new Set<string>();

export function useDirectInbox() {
  const spaceIds = useDirectSpaceIds();
  const relayId = useRelayStore((s) => s.info?.serverId ?? null);
  const spaces = useRelayStore((s) => s.spaces);
  const inboxes = useQueries({
    queries: spaceIds.map((spaceId) => ({
      queryKey: queryKeys.conversations(spaceId),
      queryFn: () => fetchInboxConversations(spaceId),
      staleTime: 30_000,
      networkMode: "offlineFirst" as const,
    })),
  });
  const items = useMemo(() => inboxes.flatMap((q) => q.data?.items ?? []), [inboxes]);
  const predecessorQueries = useQueries({
    queries: items.map((item) => ({
      queryKey: ["conversationPredecessor", item.serverId, item.id] as const,
      queryFn: () => fetchConversationPredecessor(item.serverId, item.id),
      staleTime: Infinity,
      retry: false,
    })),
  });
  const predecessors = useMemo(() => {
    const map = new Map<string, PredecessorView>();
    for (const query of predecessorQueries) if (query.data) map.set(query.data.id, query.data);
    return map;
  }, [predecessorQueries]);
  const { hidden, nonCanonical } = useMemo(
    () =>
      supersededConversations(
        items,
        predecessors,
        (spaceId) => spaces[spaceId]?.hostServerId ?? null,
        relayId,
      ),
    [items, predecessors, spaces, relayId],
  );

  // Members leave the successor that is not canonical.
  useEffect(() => {
    for (const conversation of nonCanonical) {
      if (leftNonCanonical.has(conversation.id)) continue;
      leftNonCanonical.add(conversation.id);
      void leaveConversation(conversation.serverId, conversation.id).catch((err: unknown) =>
        logger.warn("[RIM:relay] leaving a duplicate successor failed:", err),
      );
    }
  }, [nonCanonical]);

  return {
    items: items.filter((item) => !hidden.has(item.id)),
    predecessors,
    isPending: inboxes.length === 0 || inboxes.every((q) => q.isPending),
    isError: inboxes[0]?.isError ?? false,
  };
}
