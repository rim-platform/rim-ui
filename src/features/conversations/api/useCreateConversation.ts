import { useMutation, useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";

const CREATE_CONVERSATION_MUTATION = gql`
  mutation CreateConversation($input: CreateConversationInput!) {
    createConversation(input: $input) {
      id
      title
      conversationType
      memberIds
      serverId
    }
  }
`;

interface CreateConversationInput {
  serverId: string;
  title?: string;
  conversationType?: string;
  otherUserId?: string;
  memberIds?: string[];
}

interface CreateConversationResponse {
  createConversation: {
    id: string;
    title: string;
    conversationType: string;
    memberIds: string[];
    serverId: string;
  };
}

export function useCreateConversationMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateConversationInput) =>
      graphqlClient.request<CreateConversationResponse>(CREATE_CONVERSATION_MUTATION, { input }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: queryKeys.conversations(variables.serverId) });
      qc.invalidateQueries({ queryKey: queryKeys.channels(variables.serverId) });
    },
  });
}
