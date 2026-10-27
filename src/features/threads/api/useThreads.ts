import { useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";

import type { AuthorBan } from "../../messages/hooks/useBanExpiry";
import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import { encryptedStoreAccount, readCachedThread } from "../../messages/api/messageCache";
import { MESSAGE_WITH_REACTIONS } from "../../../graphql/fragments/message";
import { MESSAGE_EDITED_AT, serverHasCapability } from "../../updater/api/serverCapabilities";

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

/** The variables of a thread's replies read. */
const THREAD_MESSAGES_VARIABLES = `
    $serverId: ID!
    $conversationId: ID!
    $threadId: ID!
    $dir: PageDir!
    $limit: Int!
    $includeDeleted: Boolean!
`;

/** The arguments of `threadMessages` in a thread's replies read. */
const THREAD_MESSAGES_ARGUMENTS = `
      serverId: $serverId
      conversationId: $conversationId
      threadId: $threadId
      dir: $dir
      limit: $limit
      includeDeleted: $includeDeleted
`;

/** The page info of a thread's replies. */
const THREAD_MESSAGES_PAGE_INFO = `
      pageInfo {
        hasNext
        hasPrev
      }
`;

const THREAD_MESSAGES_QUERY = gql`
  query ThreadMessages(${THREAD_MESSAGES_VARIABLES}) {
    threadMessages(${THREAD_MESSAGES_ARGUMENTS}) {
      items {
        ...MessageWithReactions
      }
      ${THREAD_MESSAGES_PAGE_INFO}
    }
  }
  ${MESSAGE_WITH_REACTIONS}
`;

/** The same with `Message.editedAt`, for a server that lists `message_edited_at`. */
const THREAD_MESSAGES_WITH_EDITS_QUERY = gql`
  query ThreadMessagesWithEdits(${THREAD_MESSAGES_VARIABLES}) {
    threadMessages(${THREAD_MESSAGES_ARGUMENTS}) {
      items {
        ...MessageWithReactions
        editedAt
      }
      ${THREAD_MESSAGES_PAGE_INFO}
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

interface ThreadMessageAuthor extends AuthorBan {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  /** `@<username>:<domain>`; null when the server does not know it. */
  handle?: string | null;
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
  /**
   * When the text last changed; null for a never-edited message, absent when the server does not
   * report it.
   */
  editedAt?: string | null;
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
 * from this device's store (the desktop's cache, or the web app's encrypted store), where it
 * decrypted them.
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
        const account = encryptedStoreAccount();
        const items = account
          ? await readCachedThread(account, workspaceId!, conversationId!, threadId!, null)
          : null;
        return {
          items: (items ?? []) as unknown as ThreadMessageItem[],
          pageInfo: { hasNext: false, hasPrev: false },
        };
      }
      const document = (await serverHasCapability(MESSAGE_EDITED_AT))
        ? THREAD_MESSAGES_WITH_EDITS_QUERY
        : THREAD_MESSAGES_QUERY;
      const res = await graphqlClient.request<ThreadMessagesResponse>(document, {
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
