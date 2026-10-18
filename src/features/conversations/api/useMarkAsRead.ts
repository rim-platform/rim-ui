import { useMutation, useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { invalidateUnreadNotificationCount } from "../../notifications/api/useNotifications";
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
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: MarkAsReadInput) => {
      return graphqlClient.request<{ markAsRead: boolean }>(MARK_AS_READ, {
        input,
      });
    },
    onMutate: (input) => {
      useUnreadStore.getState().markRead(input.conversationId);
    },
    // Reading a conversation also marks its notifications read on the server.
    onSuccess: (_data, input) => {
      invalidateUnreadNotificationCount(qc, input.workspaceId);
    },
  });
}
