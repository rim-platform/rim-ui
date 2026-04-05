import { useMutation, useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";

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
      qc.invalidateQueries({ queryKey: queryKeys.channels(vars.serverId) });
      qc.invalidateQueries({ queryKey: queryKeys.conversations(vars.serverId) });
    },
  });
}
