import { useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import type { MessagesPage } from "./useMessages";

const EDIT_MESSAGE = gql`
  mutation EditMessage($input: EditMessageInput!) {
    editMessage(input: $input) {
      id
      text
      isDeleted
      sentAt
    }
  }
`;

interface EditMessageVars {
  serverId: string;
  conversationId: string;
  messageId: string;
  text: string;
}

export function useEditMessageMutation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (vars: EditMessageVars) =>
      graphqlClient.request(EDIT_MESSAGE, {
        input: {
          serverId: vars.serverId,
          conversationId: vars.conversationId,
          messageId: vars.messageId,
          text: vars.text,
        },
      }),
    onMutate: async (vars) => {
      const messagesKey = queryKeys.messages(vars.serverId, vars.conversationId);
      await qc.cancelQueries({ queryKey: messagesKey });

      const previousData = qc.getQueryData<InfiniteData<MessagesPage>>(messagesKey);

      // Optimistic update
      qc.setQueryData<InfiniteData<MessagesPage>>(messagesKey, (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            items: page.items.map((m) => (m.id === vars.messageId ? { ...m, text: vars.text } : m)),
          })),
        };
      });

      return { previousData };
    },
    onError: (_err, vars, context) => {
      // Revert optimistic update on failure
      if (context?.previousData) {
        const messagesKey = queryKeys.messages(vars.serverId, vars.conversationId);
        qc.setQueryData(messagesKey, context.previousData);
      }
    },
    onSettled: (_data, _err, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.messages(vars.serverId, vars.conversationId) });
    },
  });
}
