import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { errorSentence } from "../../../core/graphql/errors";
import { queryKeys } from "../../../core/query/keys";
import { toast } from "../../../shared/toast";

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

/** Refreshes a conversation's timeline once a reaction in it changed. */
export function invalidateAfterReaction(
  qc: QueryClient,
  serverId: string,
  conversationId: string,
): void {
  qc.invalidateQueries({ queryKey: queryKeys.messages(serverId, conversationId) });
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
      invalidateAfterReaction(qc, vars.serverId, vars.conversationId);
    },
    onError: (err) => {
      toast.error("The reaction could not be changed", {
        description: errorSentence(err, "Try again."),
      });
    },
  });
}
