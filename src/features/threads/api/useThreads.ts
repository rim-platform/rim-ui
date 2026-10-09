import { useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import { currentCacheAccount, readCachedThread } from "../../messages/api/messageCache";
import { MESSAGE_WITH_REACTIONS } from "../../../graphql/fragments/message";

const THREAD_BY_ROOT_MESSAGE_QUERY = gql`
  query ThreadByRootMessage($serverId: ID!, $conversationId: ID!, $rootMessageId: ID!) {
    threadByRootMessage(
      serverId: $serverId
      conversationId: $conversationId
      rootMessageId: $rootMessageId
    ) {
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
  query ThreadMessages(
    $serverId: ID!
    $conversationId: ID!
    $threadId: ID!
    $dir: PageDir!
    $limit: Int!
    $includeDeleted: Boolean!
  ) {
    threadMessages(
      serverId: $serverId
      conversationId: $conversationId
      threadId: $threadId
      dir: $dir
      limit: $limit
      includeDeleted: $includeDeleted
    ) {
      items {
        ...MessageWithReactions
      }
      pageInfo {
        hasNext
        hasPrev
      }
    }
  }
  ${MESSAGE_WITH_REACTIONS}
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

interface ThreadMessageAuthor {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

interface ThreadMessageLinkPreview {
  id: string;
  url: string;
  title?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  siteName?: string | null;
}

interface ThreadMessageItem {
  id: string;
  serverId: string;
  conversationId: string;
  threadId: string | null;
  rootThreadId: string | null;
  authorId: string;
  author: ThreadMessageAuthor | null;
  text: string;
  hasAttachments: boolean;
  parentMessageId: string | null;
  isDeleted: boolean;
  sentAt: string;
  reactions: ThreadMessageReaction[];
  linkPreviews: ThreadMessageLinkPreview[];
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

/**
 * A thread's replies, oldest first. In an encrypted conversation (`fromCache`) they are read
 * from the desktop's cache, where this device decrypted them.
 */
export function useThreadMessages(
  workspaceId?: string,
  conversationId?: string,
  threadId?: string,
  fromCache = false,
) {
  return useQuery({
    queryKey: queryKeys.threadMessages(workspaceId, conversationId, threadId),
    enabled: Boolean(workspaceId && conversationId && threadId),
    staleTime: 10_000,
    queryFn: async () => {
      if (fromCache) {
        const account = currentCacheAccount();
        const items = account
          ? await readCachedThread(account, workspaceId!, conversationId!, threadId!, null)
          : null;
        return {
          items: (items ?? []) as unknown as ThreadMessageItem[],
          pageInfo: { hasNext: false, hasPrev: false },
        };
      }
      const res = await graphqlClient.request<ThreadMessagesResponse>(THREAD_MESSAGES_QUERY, {
        serverId: workspaceId!,
        conversationId: conversationId!,
        threadId: threadId!,
        dir: "AFTER",
        limit: 80,
        includeDeleted: false,
      });
      return res.threadMessages;
    },
  });
}
