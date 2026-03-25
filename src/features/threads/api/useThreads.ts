import { useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";

const THREAD_BY_ROOT_MESSAGE_QUERY = gql`
  query ThreadByRootMessage($serverId: ID!, $conversationId: ID!, $rootMessageId: ID!) {
    threadByRootMessage(serverId: $serverId, conversationId: $conversationId, rootMessageId: $rootMessageId) {
      id
      serverId
      conversationId
      rootMessageId
      rootAuthorId
      rootText
      createdAt
      lastMessageAt
    }
  }
`;

const THREAD_MESSAGES_QUERY = gql`
  query ThreadMessages($serverId: ID!, $conversationId: ID!, $threadId: ID!, $dir: PageDir!, $limit: Int!, $includeDeleted: Boolean!) {
    threadMessages(
      serverId: $serverId
      conversationId: $conversationId
      threadId: $threadId
      dir: $dir
      limit: $limit
      includeDeleted: $includeDeleted
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
      pageInfo {
        hasNext
        hasPrev
      }
    }
  }
`;

interface ThreadDetail {
  id: string;
  serverId: string;
  conversationId: string;
  rootMessageId: string;
  rootAuthorId: string;
  rootText: string;
  createdAt: string;
  lastMessageAt: string;
}

interface ThreadMessageReaction {
  emoji: string;
  count: number;
  reactedByMe: boolean;
  userIds: string[];
}

interface ThreadMessageItem {
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
  reactions: ThreadMessageReaction[];
}

interface ThreadByRootMessageResponse {
  threadByRootMessage: ThreadDetail | null;
}

interface ThreadMessagesResponse {
  threadMessages: {
    items: ThreadMessageItem[];
    pageInfo: { hasNext: boolean; hasPrev: boolean };
  };
}

export function useThreadByRootMessage(
  workspaceId?: string,
  conversationId?: string,
  rootMessageId?: string,
) {
  return useQuery({
    queryKey: queryKeys.threadByRoot(workspaceId, conversationId, rootMessageId),
    enabled: Boolean(workspaceId && conversationId && rootMessageId),
    staleTime: 30_000,
    queryFn: async () => {
      const res = await graphqlClient.request<ThreadByRootMessageResponse>(
        THREAD_BY_ROOT_MESSAGE_QUERY,
        {
          serverId: workspaceId!,
          conversationId: conversationId!,
          rootMessageId: rootMessageId!,
        },
      );
      return res.threadByRootMessage;
    },
  });
}

export function useThreadMessages(
  workspaceId?: string,
  conversationId?: string,
  threadId?: string,
) {
  return useQuery({
    queryKey: queryKeys.threadMessages(workspaceId, conversationId, threadId),
    enabled: Boolean(workspaceId && conversationId && threadId),
    staleTime: 10_000,
    queryFn: async () => {
      const res = await graphqlClient.request<ThreadMessagesResponse>(
        THREAD_MESSAGES_QUERY,
        {
          serverId: workspaceId!,
          conversationId: conversationId!,
          threadId: threadId!,
          dir: "AFTER",
          limit: 80,
          includeDeleted: false,
        },
      );
      return res.threadMessages;
    },
  });
}

