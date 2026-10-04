import { useMutation, useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";

const TOGGLE_REACTION = gql`
  mutation ToggleReaction($input: ToggleReactionInput!) {
    toggleReaction(input: $input) {
      emoji
      count
      reactedByMe
    }
  }
`;

interface ToggleReactionVars {
  serverId: string;
  conversationId: string;
  messageId: string;
  emoji: string;
}

export function useToggleReactionMutation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (vars: ToggleReactionVars) =>
      graphqlClient.request(TOGGLE_REACTION, {
        input: {
          serverId: vars.serverId,
          conversationId: vars.conversationId,
          messageId: vars.messageId,
          emoji: vars.emoji,
        },
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.messages(vars.serverId, vars.conversationId) });
    },
  });
}
