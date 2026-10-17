import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
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
function refreshAfterMute(qc: QueryClient, serverId: string, conversationId: string): void {
  qc.invalidateQueries({ queryKey: queryKeys.mutedConversations(serverId) });
  qc.invalidateQueries({ queryKey: queryKeys.conversation(serverId, conversationId) });
  qc.invalidateQueries({ queryKey: queryKeys.channels(serverId) });
  qc.invalidateQueries({ queryKey: queryKeys.conversations(serverId) });
}

export function useMuteConversationMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: MuteConversationVars) =>
      graphqlClient.request(MUTE_CONVERSATION, {
        input: {
          serverId: vars.serverId,
          conversationId: vars.conversationId,
          mutedUntil: vars.mutedUntil ?? null,
        },
      }),
    onMutate: (vars) => {
      useMutedStore.getState().mute(vars.conversationId);
    },
    onError: (_err, vars) => {
      useMutedStore.getState().unmute(vars.conversationId);
    },
    onSettled: (_data, _err, vars) => refreshAfterMute(qc, vars.serverId, vars.conversationId),
  });
}

export function useUnmuteConversationMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: UnmuteConversationVars) =>
      graphqlClient.request(UNMUTE_CONVERSATION, {
        input: {
          serverId: vars.serverId,
          conversationId: vars.conversationId,
        },
      }),
    onMutate: (vars) => {
      useMutedStore.getState().unmute(vars.conversationId);
    },
    onError: (_err, vars) => {
      useMutedStore.getState().mute(vars.conversationId);
    },
    onSettled: (_data, _err, vars) => refreshAfterMute(qc, vars.serverId, vars.conversationId),
  });
}
