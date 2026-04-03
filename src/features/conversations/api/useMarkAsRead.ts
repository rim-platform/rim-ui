import { useMutation } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { useUnreadStore } from "../state/useUnreadStore";

const MARK_AS_READ = gql`
  mutation MarkAsRead($input: MarkAsReadInput!) {
    markAsRead(input: $input)
  }
`;

export const MARK_ALL_AS_READ = gql`
  mutation MarkAllAsRead($input: MarkAllAsReadInput!) {
    markAllAsRead(input: $input)
  }
`;

interface MarkAsReadInput {
  conversationId: string;
  workspaceId: string;
  readAt: string;
}

export function useMarkAsRead() {
  return useMutation({
    mutationFn: async (input: MarkAsReadInput) => {
      return graphqlClient.request<{ markAsRead: boolean }>(MARK_AS_READ, {
        input,
      });
    },
    onMutate: (input) => {
      useUnreadStore.getState().markRead(input.conversationId);
    },
  });
}
