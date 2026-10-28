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
import { MESSAGES_QUERY, MESSAGES_WITH_EDITS_QUERY } from "../../../core/graphql/queries";
import { MESSAGE_FIELDS } from "../../../graphql/fragments/message";
import type { MessageItem, MessageCursor, MessagesPage } from "../../../core/types/messages";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useConversation } from "../../conversations/api/useConversation";
import { refusePlaintextIfEncrypted } from "../../e2ee/runtime/pins";
import { useE2eeStore } from "../../e2ee/state/useE2eeStore";
import { requestCacheSync } from "../runtime/messageCacheSync";
import { insertTimelineMessage, messageFromSend, type SentMessage } from "./timelineMessages";
import {
  currentCacheAccount,
  encryptedStoreAccount,
  isServerUnreachable,
  readCachedTimeline,
  trackConversation,
} from "./messageCache";
import { withServerMetadata } from "./serverMetadata";
import { MESSAGE_EDITED_AT, serverHasCapability } from "../../updater/api/serverCapabilities";

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
 * A conversation's timeline. On the desktop app the local message cache serves it
 * first: its newest page shows while the server answers, and a page the server cannot be
 * reached for comes from the cache. The server stays the source of what is shown once it
 * answers; the cache only fills the gaps.
 *
 * An end-to-end encrypted conversation is read from the cache only: the server holds its
 * messages as ciphertext, which this device decrypted once, into the cache. Their reactions,
 * pins and threads, which the server keeps in the clear, come from the server. The web app keeps
 * encrypted conversations (and only those) in its own encrypted store once the browser is set
 * up as a linked device.
 */
export function useConversationMessages(workspaceId?: string, conversationId?: string) {
  const qc = useQueryClient();
  // Re-run the cache effects when the signed-in user changes.
  const userId = useAuthStore((s) => s.session?.userId);
  // The web app's encrypted store opens once this browser is set up for encryption.
  const webEncryption = useE2eeStore((s) => s.webEncryption);
  const hasConversation = Boolean(workspaceId && conversationId);
  const cacheAvailable = Boolean(userId && hasConversation && currentCacheAccount());
  const storeAvailable =
    cacheAvailable ||
    Boolean(userId && hasConversation && webEncryption === "ready" && encryptedStoreAccount());
  // Only a device with a store can read an encrypted conversation from one.
  const { data: conversation } = useConversation(
    storeAvailable ? workspaceId : undefined,
    conversationId,
  );
  // A conversation this device pinned as encrypted stays in the store whatever the server says.
  const pinned = useE2eeStore((s) => (conversationId ? s.groups[conversationId]?.pinned : false));
  const cacheOnly = storeAvailable && Boolean(conversation?.encryptedAt || pinned);
  // The web store follows encrypted conversations only.
  const follows = cacheAvailable || cacheOnly;

  // Opening a conversation makes the cache follow it, then syncs it.
  useEffect(() => {
    const account = follows ? encryptedStoreAccount() : null;
    if (!account || !workspaceId || !conversationId) return;
    void trackConversation(account, workspaceId, conversationId).then(() =>
      requestCacheSync(workspaceId, [conversationId]),
    );
  }, [userId, workspaceId, conversationId, follows]);

  // In the web app the store can open after the first read: the timeline is read again from it.
  useEffect(() => {
    if (!cacheOnly || cacheAvailable) return;
    void qc.invalidateQueries({ queryKey: queryKeys.messages(workspaceId, conversationId) });
  }, [qc, cacheOnly, cacheAvailable, workspaceId, conversationId]);

  const cached = useQuery({
    queryKey: queryKeys.cachedTimeline(workspaceId, conversationId),
    enabled: follows,
    staleTime: Infinity,
    gcTime: 60_000,
    retry: false,
    // A local read: it runs whatever the network state.
    networkMode: "always",
    queryFn: async () => {
      const account = encryptedStoreAccount();
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
        const account = encryptedStoreAccount();
        const page = account
          ? await readCachedTimeline(account, workspaceId!, conversationId!, pageParam, PAGE_SIZE)
          : null;
        if (!page) return EMPTY_PAGE;
        // The store's reactions, pins and threads are as of each message's last change.
        return withServerMetadata(workspaceId!, conversationId!, pageParam, PAGE_SIZE, page);
      }
      const variables: Record<string, unknown> = {
        serverId: workspaceId!,
        conversationId: conversationId!,
        // `messages` is a DESC endpoint (newest-first sort key): `AFTER` means "older than
        // the cursor" there, and a cursorless request returns the newest page. Infinite
        // scroll-up is therefore AFTER + `next` (the page's oldest row). `BEFORE` walks toward
        // newer messages and dead-ends after the first page.
        dir: "AFTER",
        limit: PAGE_SIZE,
        includeDeleted: false,
      };

      if (pageParam) {
        variables.cursor = pageParam;
      }

      try {
        const document = (await serverHasCapability(MESSAGE_EDITED_AT))
          ? MESSAGES_WITH_EDITS_QUERY
          : MESSAGES_QUERY;
        const res = await graphqlClient.request<MessagesResponse>(document, variables);
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

export const SEND_MESSAGE_MUTATION = gql`
  mutation SendMessage($input: SendMessageInput!) {
    sendMessage(input: $input) {
      ...MessageFields
    }
  }
  ${MESSAGE_FIELDS}
`;

interface SendMessageResponse {
  sendMessage: SentMessage;
}

export function useSendMessageMutation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (vars: {
      workspaceId: string;
      conversationId: string;
      text: string;
      /** A forward of an encrypted message, re-sent as plaintext. */
      forwardedFromMessageId?: string;
      /** The timeline message this one replies to. */
      parentMessageId?: string;
    }) => {
      await refusePlaintextIfEncrypted(qc, vars.workspaceId, vars.conversationId);
      return graphqlClient.request<SendMessageResponse>(SEND_MESSAGE_MUTATION, {
        input: {
          serverId: vars.workspaceId,
          conversationId: vars.conversationId,
          text: vars.text,
          ...(vars.forwardedFromMessageId
            ? { forwardedFromMessageId: vars.forwardedFromMessageId }
            : {}),
          ...(vars.parentMessageId ? { parentMessageId: vars.parentMessageId } : {}),
        },
      });
    },
    onSuccess: (data, vars) => {
      // The sent message goes into the timeline at once, without waiting for the WebSocket's
      // "NewMessage": whichever arrives second finds it there and changes nothing.
      insertTimelineMessage(qc, vars.workspaceId, messageFromSend(data.sendMessage));
      qc.invalidateQueries({ queryKey: queryKeys.conversations(vars.workspaceId) });
    },
  });
}
