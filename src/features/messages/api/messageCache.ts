/**
 * The desktop app's encrypted local message cache (master plan Stage 2, PR 9).
 *
 * Storage lives on the Tauri side (`src-tauri/src/message_cache`): an SQLCipher database per
 * account, keyed in the OS keyring. This module is its typed surface plus the one HTTP call it
 * needs, the server's `messageChanges` feed (rim-server `docs/message-change-feed.md`), which
 * runs here because the webview holds the session cookie.
 *
 * Everything is best-effort: in the web app, or if the cache fails, callers get `null` and
 * carry on with the server as before.
 */

import { isTauri } from "@tauri-apps/api/core";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { getGraphqlEndpoint } from "../../../core/graphql/config";
import type {
  ConversationChangesStatus,
  MessageChangeKind,
  MessageChangesInput,
} from "../../../core/graphql/generated/schema-types";
import { logger } from "../../../core/logger";
import { safeInvoke } from "../../../core/tauri/safeInvoke";
import type { MessageCursor, MessageItem, MessagesPage } from "../../../core/types/messages";
import { MESSAGE_WITH_REACTIONS } from "../../../graphql/fragments/message";
import { useAuthStore } from "../../auth/state/useAuthStore";

/** Whose cache: the server the app talks to and the signed-in user on it. */
export interface CacheAccount {
  endpoint: string;
  userId: string;
}

/** The cache's account for the signed-in user, or null when there is no cache to use. */
export function currentCacheAccount(): CacheAccount | null {
  if (!isTauri()) return null;
  const userId = useAuthStore.getState().session?.userId;
  if (!userId) return null;
  return { endpoint: getGraphqlEndpoint(), userId };
}

// ─── Change feed ────────────────────────────────────────────────────────────

export const MESSAGE_CHANGES_QUERY = gql`
  query MessageChanges($input: MessageChangesInput!) {
    messageChanges(input: $input) {
      conversationId
      status
      cursor
      hasMore
      changes {
        kind
        version
        editedAt
        message {
          ...MessageWithReactions
        }
      }
    }
  }
  ${MESSAGE_WITH_REACTIONS}
`;

export interface FeedConversationChanges {
  conversationId: string;
  status: ConversationChangesStatus;
  cursor: string;
  hasMore: boolean;
  changes: {
    kind: MessageChangeKind;
    version: string;
    editedAt: string | null;
    message: MessageItem;
  }[];
}

/** One `messageChanges` round trip. */
export type ChangeFeed = (input: MessageChangesInput) => Promise<FeedConversationChanges[]>;

export const fetchMessageChanges: ChangeFeed = async (input) => {
  const res = await graphqlClient.request<{ messageChanges: FeedConversationChanges[] }>(
    MESSAGE_CHANGES_QUERY,
    { input },
  );
  return res.messageChanges;
};

// ─── Tauri commands ─────────────────────────────────────────────────────────

async function invokeCache<T>(command: string, args: Record<string, unknown>): Promise<T | null> {
  const result = await safeInvoke<T>(command, args);
  if (result.ok) return result.value;
  if (result.error.kind !== "ipc_unavailable") {
    logger.warn(`[RIM:cache] ${command} failed:`, result.error);
  }
  return null;
}

/** Follow a conversation from now on (the user opened it). */
export async function trackConversation(
  account: CacheAccount,
  workspaceId: string,
  conversationId: string,
): Promise<void> {
  await invokeCache<null>("message_cache_track", { account, workspaceId, conversationId });
}

/**
 * Start a sync and get the first feed input. `conversationIds` for a real-time signal; omit
 * for every recently viewed conversation. `null`: nothing to sync (or no cache).
 */
export function beginCacheSync(
  account: CacheAccount,
  workspaceId: string,
  conversationIds?: string[],
): Promise<MessageChangesInput | null> {
  return invokeCache<MessageChangesInput>("message_cache_sync_begin", {
    account,
    workspaceId,
    conversationIds: conversationIds ?? null,
  });
}

/** Store a feed answer; returns the next feed input, or `null` when the sync is done. */
export function applyCacheChanges(
  account: CacheAccount,
  workspaceId: string,
  changes: FeedConversationChanges[],
): Promise<MessageChangesInput | null> {
  return invokeCache<MessageChangesInput>("message_cache_sync_apply", {
    account,
    workspaceId,
    changes,
  });
}

interface CachedTimelinePage {
  items: MessageItem[];
  hasOlder: boolean;
}

/**
 * A timeline page from the cache in the `messages` query's shape (oldest first, `next` walks
 * older), or `null` when the conversation is not fully cached on this device.
 */
export async function readCachedTimeline(
  account: CacheAccount,
  workspaceId: string,
  conversationId: string,
  before: MessageCursor | null,
  limit: number,
): Promise<MessagesPage | null> {
  const page = await invokeCache<CachedTimelinePage | null>("message_cache_timeline", {
    account,
    workspaceId,
    conversationId,
    before,
    limit,
  });
  if (!page) return null;
  return cachedPageToMessagesPage(page);
}

export function cachedPageToMessagesPage(page: CachedTimelinePage): MessagesPage {
  const oldest = page.items[0];
  const next = page.hasOlder && oldest ? { sentAt: oldest.sentAt, messageId: oldest.id } : null;
  return {
    items: page.items,
    next,
    prev: null,
    pageInfo: { hasNext: next !== null, hasPrev: false },
  };
}
