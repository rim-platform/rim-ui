import { useMutation } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
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

export function useMuteConversationMutation() {
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
  });
}

export function useUnmuteConversationMutation() {
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
  });
}
