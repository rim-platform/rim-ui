import type { QueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import { useMutedStore } from "../state/useMutedStore";

const MUTE_CONVERSATION = gql`
  mutation MuteConversation($input: MuteConversationInput!) {
    muteConversation(input: $input)
  }
`;

const UNMUTE_CONVERSATION = gql`
  mutation UnmuteConversation($input: UnmuteConversationInput!) {
    unmuteConversation(input: $input)
  }
`;

interface MuteConversationVars {
  serverId: string;
  conversationId: string;
  mutedUntil?: string | null;
}

interface UnmuteConversationVars {
  serverId: string;
  conversationId: string;
}

/**
 * A mute changes the conversation's effective notification level, so the caches that carry
 * `effectiveNotificationLevel` refetch, along with the muted list.
 */
export function refreshAfterMute(qc: QueryClient, serverId: string, conversationId: string): void {
  qc.invalidateQueries({ queryKey: queryKeys.mutedConversations(serverId) });
  qc.invalidateQueries({ queryKey: queryKeys.conversation(serverId, conversationId) });
  qc.invalidateQueries({ queryKey: queryKeys.channels(serverId) });
  qc.invalidateQueries({ queryKey: queryKeys.conversations(serverId) });
}

/**
 * Mutes a conversation with the `muteConversation` mutation, showing it muted at once and
 * unmuted again when the server refuses; the mute's caches are read again either way.
 */
export async function muteConversation(qc: QueryClient, vars: MuteConversationVars): Promise<void> {
  useMutedStore.getState().mute(vars.conversationId);
  try {
    await graphqlClient.request(MUTE_CONVERSATION, {
      input: {
        serverId: vars.serverId,
        conversationId: vars.conversationId,
        mutedUntil: vars.mutedUntil ?? null,
      },
    });
  } catch (err) {
    useMutedStore.getState().unmute(vars.conversationId);
    throw err;
  } finally {
    refreshAfterMute(qc, vars.serverId, vars.conversationId);
  }
}

/**
 * Unmutes a conversation with the `unmuteConversation` mutation, showing it unmuted at once and
 * muted again when the server refuses; the mute's caches are read again either way.
 */
export async function unmuteConversation(
  qc: QueryClient,
  vars: UnmuteConversationVars,
): Promise<void> {
  useMutedStore.getState().unmute(vars.conversationId);
  try {
    await graphqlClient.request(UNMUTE_CONVERSATION, {
      input: { serverId: vars.serverId, conversationId: vars.conversationId },
    });
  } catch (err) {
    useMutedStore.getState().mute(vars.conversationId);
    throw err;
  } finally {
    refreshAfterMute(qc, vars.serverId, vars.conversationId);
  }
}
