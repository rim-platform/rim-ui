/**
 * Blocking a person from wherever they appear, and bringing the app's lists up to date after a
 * block or an unblock.
 */
import type { QueryClient } from "@tanstack/react-query";

import { asSentence, graphqlErrorMessage } from "../../../core/graphql/errors";
import { logger } from "../../../core/logger";
import { queryKeys } from "../../../core/query/keys";
import { queryClient } from "../../../core/query/queryClient";
import { toast } from "../../../shared/toast";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useUnreadStore } from "../../conversations/state/useUnreadStore";
import type { ConversationSummaryPage } from "../../conversations/types";
import { requestCacheSync } from "../../messages/runtime/messageCacheSync";
import type { ServerMember } from "../../workspaces/api/useServerMembers";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { blockPrincipal, type BlockedPrincipalView } from "../api/relayApi";
import { useContactStore } from "../contacts/useContactStore";
import { noteBlockedHere } from "../runtime/useBlockedConversationsRuntime";
import { useRelayStore } from "../state/useRelayStore";
import { askToBlock } from "./useBlockPersonStore";

/** Someone the account can block: their principal id and the name the app shows for them. */
export interface BlockTarget {
  principalId: string;
  name: string;
}

/**
 * `userId` of `spaceId` (the open workspace when absent) as someone to block, by that space's
 * member list as cached: `null` with the relay off, for the viewer, for someone without a
 * principal id or not in the list, and for someone already blocked.
 */
export function blockTargetOf(userId: string, spaceId?: string | null): BlockTarget | null {
  const relay = useRelayStore.getState();
  if (relay.info === null) return null;
  const space = spaceId ?? useWorkspaceStore.getState().workspaceId;
  if (!space) return null;
  const member = queryClient
    .getQueryData<ServerMember[]>(queryKeys.serverMembers(space))
    ?.find((m) => m.userId === userId);
  const principalId = member?.principalId;
  if (!member || !principalId || principalId === relay.account?.principalId) return null;
  const blocked = queryClient.getQueryData<BlockedPrincipalView[]>(queryKeys.myBlockedPrincipals);
  if (blocked?.some((b) => b.principalId === principalId)) return null;
  const name =
    useContactStore.getState().aliases[principalId] || member.displayName || member.username;
  return { principalId, name };
}

/** The Block… action for `userId`, or `undefined` when {@link blockTargetOf} names nobody. */
export function blockActionFor(userId: string, spaceId?: string | null): (() => void) | undefined {
  const target = blockTargetOf(userId, spaceId);
  return target ? () => askToBlock(target) : undefined;
}

/** Conversation ids per space, of every cached conversation list on this server's spaces. */
type Lists = Map<string, Set<string>>;

function snapshotLists(qc: QueryClient): Lists {
  const spaces = useRelayStore.getState().spaces;
  const lists: Lists = new Map();
  for (const [key, page] of qc.getQueriesData<ConversationSummaryPage>({
    queryKey: ["conversations"],
  })) {
    const spaceId = key[1];
    if (typeof spaceId !== "string" || spaceId in spaces) continue;
    const ids = lists.get(spaceId) ?? new Set<string>();
    for (const c of page?.items ?? []) ids.add(c.id);
    lists.set(spaceId, ids);
  }
  return lists;
}

function difference(from: Lists, other: Lists): Lists {
  const out: Lists = new Map();
  for (const [spaceId, ids] of from) {
    const rest = [...ids].filter((id) => !other.get(spaceId)?.has(id));
    if (rest.length > 0) out.set(spaceId, new Set(rest));
  }
  return out;
}

/**
 * Refetch every conversation list, the unread counts and the notifications. Returns the ids
 * that left each list of a space this server hosts (`gone`) and those that came back (`back`).
 * Spaces bound on other servers are left to `useBlockedConversationsRuntime`.
 */
export async function refreshAfterBlockChange(
  qc: QueryClient,
): Promise<{ gone: Lists; back: Lists }> {
  try {
    const before = snapshotLists(qc);
    await qc.invalidateQueries({ queryKey: ["conversations"], refetchType: "all" });
    void qc.invalidateQueries({ queryKey: ["unreadCounts"] });
    void qc.invalidateQueries({ queryKey: ["unreadNotificationCount"] });
    void qc.invalidateQueries({ queryKey: ["notifications"] });
    const after = snapshotLists(qc);
    const gone = difference(before, after);
    const back = difference(after, before);
    for (const ids of gone.values()) {
      for (const id of ids) useUnreadStore.getState().markRead(id);
    }
    for (const [spaceId, ids] of back) {
      requestCacheSync(spaceId, [...ids]);
      for (const id of ids) {
        void qc.invalidateQueries({ queryKey: queryKeys.messages(spaceId, id) });
        void qc.invalidateQueries({ queryKey: queryKeys.cachedTimeline(spaceId, id) });
      }
    }
    return { gone, back };
  } catch (err) {
    logger.warn("[RIM:relay] refreshing the lists after a block change failed:", err);
    return { gone: new Map(), back: new Map() };
  }
}

/**
 * Blocks `target` on the relay, then refreshes the lists so what the block hides leaves them,
 * and closes the open conversation when it was one of those. Says so in a toast either way.
 * @returns whether the block was made
 */
export async function blockPerson(qc: QueryClient, target: BlockTarget): Promise<boolean> {
  try {
    await blockPrincipal(target.principalId);
  } catch (err) {
    toast.error(graphqlErrorMessage(err, `Could not block ${target.name}`));
    return false;
  }
  noteBlockedHere(target.principalId);
  await qc.invalidateQueries({ queryKey: queryKeys.myBlockedPrincipals });
  await qc.invalidateQueries({ queryKey: queryKeys.relayContacts });
  const { gone } = await refreshAfterBlockChange(qc);
  const workspaceId = useWorkspaceStore.getState().workspaceId;
  const selected = useShellStore.getState().selectedConversationId;
  if (workspaceId && selected && gone.get(workspaceId)?.has(selected)) {
    useShellStore.getState().setSelectedConversationId(null);
  }
  toast.success(asSentence(`Blocked ${target.name}`), {
    description:
      "Your DMs with them and the groups they started stay hidden until you unblock them in Settings → Direct messages.",
  });
  return true;
}
