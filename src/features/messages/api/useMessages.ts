import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";

export const MESSAGES_QUERY = gql`
  query Messages(
    $serverId: ID!
    $conversationId: ID!
    $dir: PageDir!
    $limit: Int!
    $includeDeleted: Boolean!
    $cursor: MessageCursorInput
  ) {
    messages(
      serverId: $serverId
      conversationId: $conversationId
      dir: $dir
      limit: $limit
      includeDeleted: $includeDeleted
      cursor: $cursor
    ) {
      items {
        id
        serverId
        conversationId
        threadId
        rootThreadId
        authorId
        text
        hasAttachments
        parentMessageId
        isDeleted
        sentAt
        reactions {
          emoji
          count
          reactedByMe
          userIds
        }
      }
      next {
        sentAt
        messageId
      }
      prev {
        sentAt
        messageId
      }
      pageInfo {
        hasNext
        hasPrev
      }
    }
  }
`;

interface MessageReaction {
  emoji: string;
  count: number;
  reactedByMe: boolean;
  userIds: string[];
}

export interface MessageItem {
  id: string;
  serverId: string;
  conversationId: string;
  threadId?: string | null;
  rootThreadId?: string | null;
  authorId: string;
  text: string;
  hasAttachments: boolean;
  parentMessageId?: string | null;
  isDeleted: boolean;
  sentAt: string;
  reactions: MessageReaction[];
}

interface MessageCursor {
  sentAt: string;
  messageId: string;
}

export interface MessagesPage {
  items: MessageItem[];
  next: MessageCursor | null;
  prev: MessageCursor | null;
  pageInfo: { hasNext: boolean; hasPrev: boolean };
}

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
      // Backend BEFORE dir returns items newest-first; next cursor continues in same direction (older)
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
      id
      serverId
      conversationId
      threadId
      rootThreadId
      authorId
      text
      hasAttachments
      parentMessageId
      isDeleted
      sentAt
    }
  }
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
      qc.invalidateQueries({ queryKey: queryKeys.messages(vars.workspaceId, vars.conversationId) });
      qc.invalidateQueries({ queryKey: queryKeys.conversations(vars.workspaceId) });
    },
  });
}
