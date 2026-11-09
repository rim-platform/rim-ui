import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { errorSentence } from "../../../core/graphql/errors";
import { queryKeys } from "../../../core/query/keys";
import { toast } from "../../../shared/toast";

const UPDATE_CONVERSATION_TOPIC = gql`
  mutation UpdateConversationTopic($input: UpdateConversationTopicInput!) {
    updateConversationTopic(input: $input) {
      id
      topic
    }
  }
`;

interface UpdateTopicVars {
  serverId: string;
  conversationId: string;
  topic: string;
}

/** Refreshes the conversation lists of a workspace once a topic in it changed. */
export function invalidateTopicQueries(qc: QueryClient, serverId: string): void {
  qc.invalidateQueries({ queryKey: queryKeys.channels(serverId) });
  qc.invalidateQueries({ queryKey: queryKeys.conversations(serverId) });
}

export function useUpdateTopicMutation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (vars: UpdateTopicVars) =>
      graphqlClient.request(UPDATE_CONVERSATION_TOPIC, {
        input: {
          serverId: vars.serverId,
          conversationId: vars.conversationId,
          topic: vars.topic,
        },
      }),
    onSuccess: (_data, vars) => {
      invalidateTopicQueries(qc, vars.serverId);
    },
    onError: (err) => {
      toast.error("The topic could not be changed", {
        description: errorSentence(err, "Try again."),
      });
    },
  });
}
