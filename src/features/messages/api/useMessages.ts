import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import { MESSAGES_QUERY } from "../../../core/graphql/queries";
import { MESSAGE_FIELDS } from "../../../graphql/fragments/message";
import type { MessageItem, MessageCursor, MessagesPage } from "../../../core/types/messages";

export { MESSAGES_QUERY };
export type { MessageItem, MessageCursor, MessagesPage };

interface MessagesResponse {
  messages: MessagesPage;
}

export function useConversationMessages(workspaceId?: string, conversationId?: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.messages(workspaceId, conversationId),
    enabled: Boolean(workspaceId && conversationId),
    staleTime: 10_000,
    initialPageParam: null as MessageCursor | null,
    queryFn: async ({ pageParam }) => {
      const variables: Record<string, unknown> = {
        serverId: workspaceId!,
        conversationId: conversationId!,
        dir: "BEFORE",
        limit: 50,
        includeDeleted: false,
      };

      if (pageParam) {
        variables.cursor = pageParam;
      }

      const res = await graphqlClient.request<MessagesResponse>(MESSAGES_QUERY, variables);
      return res.messages;
    },
    getNextPageParam: (lastPage) => {
      // "Next page" in infinite query terms = older messages (scrolling up)
      // Backend BEFORE dir returns items in display order (oldest-first); next cursor continues in same direction (older)
      if (lastPage.pageInfo.hasNext && lastPage.next) {
        return lastPage.next;
      }
      return undefined;
    },
  });
}

const SEND_MESSAGE_MUTATION = gql`
  mutation SendMessage($input: SendMessageInput!) {
    sendMessage(input: $input) {
      ...MessageFields
    }
  }
  ${MESSAGE_FIELDS}
`;

interface SendMessageResponse {
  sendMessage: {
    id: string;
    serverId: string;
    conversationId: string;
    threadId: string | null;
    rootThreadId: string | null;
    authorId: string;
    text: string;
    hasAttachments: boolean;
    parentMessageId: string | null;
    isDeleted: boolean;
    sentAt: string;
  };
}

export function useSendMessageMutation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (vars: { workspaceId: string; conversationId: string; text: string }) =>
      graphqlClient.request<SendMessageResponse>(SEND_MESSAGE_MUTATION, {
        input: { serverId: vars.workspaceId, conversationId: vars.conversationId, text: vars.text },
      }),
    onSuccess: (_data, vars) => {
      // Note: messages query is NOT invalidated here because the WebSocket
      // "NewMessage" event already appends the message to the cache.
      // Invalidating would cause a double-update and scroll jump.
      qc.invalidateQueries({ queryKey: queryKeys.conversations(vars.workspaceId) });
    },
  });
}
