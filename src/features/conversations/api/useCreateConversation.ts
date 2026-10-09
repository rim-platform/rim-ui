import { useMutation, useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import type { CreateConversationInput } from "../../../core/graphql/generated/schema-types";
import { CONVERSATION_FIELDS } from "../../../graphql/fragments/conversation";
import type { ConversationSummary } from "../types";

const CREATE_CONVERSATION_MUTATION = gql`
  mutation CreateConversation($input: CreateConversationInput!) {
    createConversation(input: $input) {
      ...ConversationFields
    }
  }
  ${CONVERSATION_FIELDS}
`;

interface CreateConversationResponse {
  createConversation: ConversationSummary;
}

/** Create a conversation outside React: a DM or group in a direct space, a successor. */
export async function createConversation(
  input: CreateConversationInput,
): Promise<ConversationSummary> {
  const res = await graphqlClient.request<CreateConversationResponse>(
    CREATE_CONVERSATION_MUTATION,
    { input },
  );
  return res.createConversation;
}

export function useCreateConversationMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateConversationInput) =>
      graphqlClient.request<CreateConversationResponse>(CREATE_CONVERSATION_MUTATION, { input }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: queryKeys.conversations(variables.serverId) });
      // The `channels` prefix also covers the joined (sidebar) list.
      qc.invalidateQueries({ queryKey: queryKeys.channels(variables.serverId) });
    },
  });
}
