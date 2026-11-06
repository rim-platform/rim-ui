import { useInfiniteQuery } from "@tanstack/react-query";

import { graphqlClient } from "../../../core/graphql/client";
import { MESSAGES_DOCUMENTS } from "../../../core/graphql/queries";
import { queryKeys } from "../../../core/query/keys";
import type { MessageCursor, MessageItem, MessagesPage } from "../../../core/types/messages";
import { isAfter } from "../../../shared/utils/timestamps";
import { encryptedStoreAccount, readCachedTimeline } from "../../messages/api/messageCache";
import { messageReadDocument } from "../../updater/api/serverCapabilities";

/** Messages a group shows at a time. */
export const GROUP_PAGE_SIZE = 20;

/** The highest id, so a cursor at the marker's time leaves out what was sent at that very time. */
const LAST_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";

/** How many of this device's store pages are walked back to reach the marker. */
const STORE_PAGES_WALKED = 5;
const STORE_PAGE_SIZE = 100;

/** A group's page: its messages oldest first, and where the next one starts. */
export interface GroupPage {
  items: MessageItem[];
  next: MessageCursor | number | null;
  /** The server holds these messages encrypted and this device has no text for them. */
  unreadable: boolean;
}

/** The messages after `marker` from the server: `BEFORE` walks toward newer on this endpoint. */
async function readFromServer(
  workspaceId: string,
  conversationId: string,
  cursor: MessageCursor,
): Promise<GroupPage> {
  const document = await messageReadDocument(MESSAGES_DOCUMENTS);
  const res = await graphqlClient.request<{ messages: MessagesPage }>(document, {
    serverId: workspaceId,
    conversationId,
    dir: "BEFORE",
    cursor,
    limit: GROUP_PAGE_SIZE,
    includeDeleted: false,
  });
  const { items, next, pageInfo } = res.messages;
  return {
    items,
    next: pageInfo.hasNext && next ? next : null,
    unreadable: items.some((item) => Boolean(item.encryption) && !item.e2ee),
  };
}

/** The messages after `marker` this device has decrypted, read from its store alone. */
async function readFromStore(
  workspaceId: string,
  conversationId: string,
  marker: string,
  offset: number,
): Promise<GroupPage> {
  const account = encryptedStoreAccount();
  if (!account) return { items: [], next: null, unreadable: true };
  const found: MessageItem[] = [];
  let before: MessageCursor | null = null;
  for (let walked = 0; walked < STORE_PAGES_WALKED; walked++) {
    const page: MessagesPage | null = await readCachedTimeline(
      account,
      workspaceId,
      conversationId,
      before,
      STORE_PAGE_SIZE,
    );
    if (!page) break;
    const after = page.items.filter((item) => isAfter(item.sentAt, marker));
    found.unshift(...after);
    if (after.length < page.items.length || !page.next) break;
    before = page.next;
  }
  const end = offset + GROUP_PAGE_SIZE;
  return {
    items: found.slice(offset, end),
    next: end < found.length ? end : null,
    unreadable: found.length === 0,
  };
}

interface GroupMessagesOptions {
  workspaceId: string;
  conversationId: string;
  marker: string | null;
  /** Whether the conversation is end-to-end encrypted, which keeps the read on this device. */
  encrypted: boolean;
  /** Whether the group may read now; false until it has been in view, or is known to be readable. */
  enabled: boolean;
}

/**
 * The first unread messages of one conversation, oldest first, a page at a time. An encrypted
 * conversation is read from this device's store only, as the timeline reads it. The query has its
 * own key under `unreadGroupMessages`, so message events reach it and the timeline's cache stays
 * as it was.
 */
export function useUnreadGroupMessages({
  workspaceId,
  conversationId,
  marker,
  encrypted,
  enabled,
}: GroupMessagesOptions) {
  return useInfiniteQuery({
    queryKey: queryKeys.unreadGroupMessages(
      workspaceId,
      conversationId,
      marker ?? "",
      encrypted ? "store" : "server",
    ),
    enabled: enabled && marker !== null,
    staleTime: 10_000,
    // Runs offline too, as the timeline does, and always when it reads this device's store.
    networkMode: encrypted ? "always" : "offlineFirst",
    initialPageParam: null as MessageCursor | number | null,
    queryFn: ({ pageParam }): Promise<GroupPage> =>
      encrypted
        ? readFromStore(workspaceId, conversationId, marker!, Number(pageParam ?? 0))
        : readFromServer(
            workspaceId,
            conversationId,
            (pageParam as MessageCursor | null) ?? { sentAt: marker!, messageId: LAST_ID },
          ),
    getNextPageParam: (lastPage) => lastPage.next,
  });
}
