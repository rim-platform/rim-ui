import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";

import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import { fetchUnreadCounts } from "../../conversations/api/useUnreadCounts";
import {
  isMuteActive,
  type MutedConversationItem,
} from "../../conversations/api/useMutedConversations";
import { useUnreadStore } from "../../conversations/state/useUnreadStore";
import { inboxQueryOptions } from "../../conversations/api/useInboxConversations";
import { joinedChannelsQueryOptions } from "../../conversations/api/useChannels";
import type { ConversationSummary } from "../../conversations/types";
import { useDeferredMarks } from "../../conversations/api/deferredMark";
import { useHomeWorkspaces } from "../../home/api/useHomeWorkspaces";
import { useDirectSpaceIds } from "../../relay/api/useDirectInbox";
import { useBlockedConversations } from "../../relay/state/useBlockedConversations";

const MUTED_QUERY = gql`
  query UnreadsMutedConversations($serverId: ID!) {
    mutedConversations(serverId: $serverId) {
      conversationId
      mutedUntil
    }
  }
`;

const COUNTS_POLL_MS = 60_000;

/** A space the page covers. */
export interface UnreadSpace {
  id: string;
  label: string;
  direct: boolean;
}

/** One conversation with unread messages, or with a mark on its way. */
export interface UnreadGroup {
  conversationId: string;
  space: UnreadSpace;
  count: number;
  /** Where its unread messages start; null on a host without read markers. */
  marker: string | null;
  /** How the lists know it; undefined while they load or when they do not reach it. */
  conversation: ConversationSummary | undefined;
  /** Whether the lists of its space are still loading. */
  namesPending: boolean;
  muted: boolean;
  /** The mark on its way, if any. */
  markId: number | null;
  /** Whether that mark covers this conversation alone, so its place shows it with an Undo. */
  markedAlone: boolean;
}

/** A space whose counts or lists did not answer. */
export interface FailedSpace {
  space: UnreadSpace;
  retry: () => void;
}

interface UnreadGroups {
  spaces: UnreadSpace[];
  groups: UnreadGroup[];
  failed: FailedSpace[];
  isPending: boolean;
}

/**
 * The conversations with something unread across this account's spaces, from the unread store.
 * Opening the page reads every space's counts again; after that the open workspace follows its
 * events and the others are read every minute. Conversations hidden because someone blocked
 * started them are left out.
 */
export function useUnreadGroups(): UnreadGroups {
  const { workspaces, isPending: workspacesPending } = useHomeWorkspaces();
  const directIds = useDirectSpaceIds();
  const counts = useUnreadStore((s) => s.counts);
  const spaceOf = useUnreadStore((s) => s.spaceOf);
  const markers = useUnreadStore((s) => s.markers);
  const marks = useDeferredMarks((s) => s.marks);
  const blocked = useBlockedConversations((s) => s.bySpace);

  const spaces = useMemo<UnreadSpace[]>(
    () => [
      ...workspaces.map((w) => ({ id: w.id, label: w.label, direct: false })),
      ...directIds.map((id) => ({ id, label: "Direct messages", direct: true })),
    ],
    [workspaces, directIds],
  );

  const countResults = useQueries({
    queries: spaces.map((space) => ({
      queryKey: queryKeys.unreadCounts(space.id),
      staleTime: COUNTS_POLL_MS,
      refetchOnMount: "always" as const,
      queryFn: () => fetchUnreadCounts(space.id),
    })),
  });

  const markOf = useMemo(() => {
    const map = new Map<string, { markId: number; markedAlone: boolean; spaceId: string }>();
    for (const mark of marks) {
      for (const { conversationId, workspaceId } of mark.conversations) {
        map.set(conversationId, {
          markId: mark.id,
          markedAlone: mark.conversations.length === 1,
          spaceId: workspaceId,
        });
      }
    }
    return map;
  }, [marks]);

  const conversationIdsBySpace = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const [conversationId, count] of Object.entries(counts)) {
      const space = spaceOf[conversationId];
      if (count > 0 && space) map.set(space, [...(map.get(space) ?? []), conversationId]);
    }
    // A conversation marked in full has no count left, and keeps its place until the wait ends.
    for (const [conversationId, { spaceId }] of markOf) {
      if (!map.get(spaceId)?.includes(conversationId)) {
        map.set(spaceId, [...(map.get(spaceId) ?? []), conversationId]);
      }
    }
    return map;
  }, [counts, spaceOf, markOf]);

  // The lists and mutes are read for the spaces with something to name.
  const named = useMemo(
    () => spaces.filter((space) => conversationIdsBySpace.has(space.id)),
    [spaces, conversationIdsBySpace],
  );
  const channelResults = useQueries({
    queries: named.map((space) => ({
      ...joinedChannelsQueryOptions(space.id),
      enabled: !space.direct,
    })),
  });
  const inboxResults = useQueries({
    queries: named.map((space) => inboxQueryOptions(space.id)),
  });
  const mutedResults = useQueries({
    queries: named.map((space) => ({
      queryKey: queryKeys.unreadsMuted(space.id),
      staleTime: COUNTS_POLL_MS,
      queryFn: async () => {
        const res = await graphqlClient.request<{ mutedConversations: MutedConversationItem[] }>(
          MUTED_QUERY,
          { serverId: space.id },
        );
        return res.mutedConversations;
      },
    })),
  });

  return useMemo(() => {
    const groups: UnreadGroup[] = [];
    const failures = new Map<string, FailedSpace>();
    const fail = (space: UnreadSpace, retry: () => void) => {
      const earlier = failures.get(space.id);
      failures.set(space.id, {
        space,
        retry: () => {
          earlier?.retry();
          retry();
        },
      });
    };

    spaces.forEach((space, index) => {
      const result = countResults[index];
      if (result?.isError) fail(space, () => void result.refetch());
    });

    named.forEach((space, index) => {
      const channels = channelResults[index];
      const inbox = inboxResults[index];
      const muted = mutedResults[index];
      const byId = new Map<string, ConversationSummary>();
      for (const item of channels?.data?.items ?? []) byId.set(item.id, item);
      for (const item of inbox?.data?.items ?? []) byId.set(item.id, item);
      const mutedIds = new Set(
        (muted?.data ?? []).filter((m) => isMuteActive(m)).map((m) => m.conversationId),
      );
      if ((!space.direct && channels?.isError) || inbox?.isError) {
        fail(space, () => {
          void channels?.refetch();
          void inbox?.refetch();
        });
      }
      for (const conversationId of conversationIdsBySpace.get(space.id) ?? []) {
        if (blocked[space.id]?.[conversationId]) continue;
        groups.push({
          conversationId,
          space,
          count: counts[conversationId] ?? 0,
          marker: markers[conversationId] ?? null,
          conversation: byId.get(conversationId),
          namesPending: Boolean((!space.direct && channels?.isPending) || inbox?.isPending),
          muted: mutedIds.has(conversationId),
          markId: markOf.get(conversationId)?.markId ?? null,
          markedAlone: markOf.get(conversationId)?.markedAlone ?? false,
        });
      }
    });

    return {
      spaces,
      groups,
      failed: [...failures.values()],
      isPending: workspacesPending || countResults.every((result) => result.isPending),
    };
  }, [
    spaces,
    named,
    countResults,
    channelResults,
    inboxResults,
    mutedResults,
    conversationIdsBySpace,
    counts,
    markers,
    markOf,
    blocked,
    workspacesPending,
  ]);
}
