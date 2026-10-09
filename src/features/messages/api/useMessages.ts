import { useEffect } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import { MESSAGES_QUERY } from "../../../core/graphql/queries";
import { MESSAGE_FIELDS } from "../../../graphql/fragments/message";
import type { MessageItem, MessageCursor, MessagesPage } from "../../../core/types/messages";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useConversation } from "../../conversations/api/useConversation";
import { requestCacheSync } from "../runtime/messageCacheSync";
import {
  currentCacheAccount,
  isServerUnreachable,
  readCachedTimeline,
  trackConversation,
} from "./messageCache";

export { MESSAGES_QUERY };
export type { MessageItem, MessageCursor, MessagesPage };

interface MessagesResponse {
  messages: MessagesPage;
}

const PAGE_SIZE = 50;

const EMPTY_PAGE: MessagesPage = {
  items: [],
  next: null,
  prev: null,
  pageInfo: { hasNext: false, hasPrev: false },
};

/**
 * A conversation's timeline. On the desktop app the local message cache (PR 9) serves it
 * first: its newest page shows while the server answers, and a page the server cannot be
 * reached for comes from the cache. The server stays the source of what is shown once it
 * answers; the cache only fills the gaps.
 *
 * An end-to-end encrypted conversation is read from the cache only: the server holds its
 * messages as ciphertext, which this device decrypted once, into the cache.
 */
export function useConversationMessages(workspaceId?: string, conversationId?: string) {
  // Re-run the cache effects when the signed-in user changes.
  const userId = useAuthStore((s) => s.session?.userId);
  const hasConversation = Boolean(workspaceId && conversationId);
  const cacheAvailable = Boolean(userId && hasConversation && currentCacheAccount());
  // Only the desktop app has a cache to read an encrypted conversation from.
  const { data: conversation } = useConversation(
    cacheAvailable ? workspaceId : undefined,
    conversationId,
  );
  const cacheOnly = cacheAvailable && Boolean(conversation?.encryptedAt);

  // Opening a conversation makes the cache follow it, then syncs it.
  useEffect(() => {
    const account = currentCacheAccount();
    if (!account || !workspaceId || !conversationId) return;
    void trackConversation(account, workspaceId, conversationId).then(() =>
      requestCacheSync(workspaceId, [conversationId]),
    );
  }, [userId, workspaceId, conversationId]);

  const cached = useQuery({
    queryKey: queryKeys.cachedTimeline(workspaceId, conversationId),
    enabled: cacheAvailable,
    staleTime: Infinity,
    gcTime: 60_000,
    retry: false,
    // A local read: it runs whatever the network state.
    networkMode: "always",
    queryFn: async () => {
      const account = currentCacheAccount();
      if (!account) return null;
      return readCachedTimeline(account, workspaceId!, conversationId!, null, PAGE_SIZE);
    },
  });
  const cachedPage = cached.data ?? null;

  return useInfiniteQuery({
    queryKey: queryKeys.messages(workspaceId, conversationId),
    enabled: hasConversation,
    staleTime: 10_000,
    // Runs offline too, so a page the server cannot be reached for comes from the cache.
    networkMode: cacheOnly ? "always" : "offlineFirst",
    initialPageParam: null as MessageCursor | null,
    placeholderData: cachedPage
      ? ({ pages: [cachedPage], pageParams: [null] } as InfiniteData<
          MessagesPage,
          MessageCursor | null
        >)
      : undefined,
    queryFn: async ({ pageParam }) => {
      if (cacheOnly) {
        const account = currentCacheAccount();
        const page = account
          ? await readCachedTimeline(account, workspaceId!, conversationId!, pageParam, PAGE_SIZE)
          : null;
        return page ?? EMPTY_PAGE;
      }
      const variables: Record<string, unknown> = {
        serverId: workspaceId!,
        conversationId: conversationId!,
        // `messages` is a DESC endpoint (newest-first sort key). Per docs/pagination.md,
        // `AFTER` means "older than the cursor" there, and a cursorless request returns the
        // newest page. Infinite scroll-up is therefore AFTER + `next` (the page's oldest row).
        // `BEFORE` walks toward newer messages and dead-ends after the first page (A-H1).
        dir: "AFTER",
        limit: PAGE_SIZE,
        includeDeleted: false,
      };

      if (pageParam) {
        variables.cursor = pageParam;
      }

      try {
        const res = await graphqlClient.request<MessagesResponse>(MESSAGES_QUERY, variables);
        return res.messages;
      } catch (err) {
        // The cache stands in only when the server could not be reached.
        const account = isServerUnreachable(err) ? currentCacheAccount() : null;
        if (account) {
          const page = await readCachedTimeline(
            account,
            workspaceId!,
            conversationId!,
            pageParam,
            PAGE_SIZE,
          );
          if (page) return page;
        }
        throw err;
      }
    },
    getNextPageParam: (lastPage) => {
      // "Next page" in infinite query terms = older messages (scrolling up). Items inside a
      // page are in display order (oldest-first); `next` continues in the same direction (older).
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
    mutationFn: (vars: {
      workspaceId: string;
      conversationId: string;
      text: string;
      /** A forward of an encrypted message, re-sent as plaintext. */
      forwardedFromMessageId?: string;
    }) =>
      graphqlClient.request<SendMessageResponse>(SEND_MESSAGE_MUTATION, {
        input: {
          serverId: vars.workspaceId,
          conversationId: vars.conversationId,
          text: vars.text,
          ...(vars.forwardedFromMessageId
            ? { forwardedFromMessageId: vars.forwardedFromMessageId }
            : {}),
        },
      }),
    onSuccess: (_data, vars) => {
      // Note: messages query is NOT invalidated here because the WebSocket
      // "NewMessage" event already appends the message to the cache.
      // Invalidating would cause a double-update and scroll jump.
      qc.invalidateQueries({ queryKey: queryKeys.conversations(vars.workspaceId) });
    },
  });
}
