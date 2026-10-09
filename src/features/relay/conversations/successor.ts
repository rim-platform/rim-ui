/**
 * When a DM's home is gone (it has not answered, directly or through the relay, for 7 days),
 * any member may continue the conversation in their own relay's direct space: a successor
 * with the same members that names the old one as its predecessor.
 */

import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import type { ServerMember } from "../../workspaces/api/useServerMembers";
import type { ConversationSummary } from "../../conversations/types";
import { relayUrlsFor } from "../contacts/knownRelays";
import { useRelayStore } from "../state/useRelayStore";
import { failingFor } from "../transport/relayHealth";
import { startDirectConversation, type DirectMember } from "./startDirect";

export const HOME_GONE_MS = 7 * 24 * 60 * 60 * 1000;

/** The host of a direct space on another relay whose home has been gone 7 days, or `null`. */
export function goneHome(spaceId: string, now: number = Date.now()): string | null {
  const space = useRelayStore.getState().spaces[spaceId];
  if (!space || space.kind !== "direct") return null;
  return failingFor(space.hostServerId, now) >= HOME_GONE_MS ? space.hostServerId : null;
}

/** The other members of a conversation as principals, from the member list last seen. */
export function successorMembers(spaceId: string, conversationId: string): DirectMember[] {
  const me = useRelayStore.getState().account?.principalId;
  const conversation = queryClient.getQueryData<ConversationSummary>(
    queryKeys.conversation(spaceId, conversationId),
  );
  const members = queryClient.getQueryData<ServerMember[]>(queryKeys.serverMembers(spaceId)) ?? [];
  const ids = new Set(conversation?.memberIds ?? members.map((m) => m.userId));
  return members
    .filter((m) => ids.has(m.userId) && m.principalId && m.principalId !== me)
    .map((m) => ({
      principalId: m.principalId!,
      relayUrls: relayUrlsFor(m.principalId!),
      name: m.displayName || m.username,
    }));
}

/** Continue a conversation whose home is gone in this relay's direct space. */
export async function continueConversation(
  spaceId: string,
  conversationId: string,
): Promise<{ spaceId: string; conversationId: string }> {
  const host = useRelayStore.getState().spaces[spaceId]?.hostServerId;
  if (!host) throw new Error("This conversation is hosted on this server.");
  const members = successorMembers(spaceId, conversationId);
  if (members.length === 0) throw new Error("The members of this conversation are not known here.");
  return startDirectConversation(members, { hostServerId: host, conversationId });
}
