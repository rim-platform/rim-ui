/**
 * The desktop app's encrypted local message cache (master plan Stage 2, PR 9).
 *
 * Storage lives on the Tauri side (`src-tauri/src/message_cache`): an SQLCipher database per
 * account, keyed in the secret vault. This module is its typed surface plus the one HTTP call it
 * needs, the server's `messageChanges` feed (rim-server `docs/message-change-feed.md`), which
 * runs here because the webview holds the session cookie.
 *
 * Everything is best-effort: in the web app, or if the cache fails, callers get `null` and
 * carry on with the server as before.
 */

import { isTauri } from "@tauri-apps/api/core";
import { ClientError, gql } from "graphql-request";

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
import { toast } from "../../../shared/toast";
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

/**
 * Whether a failed request means the server could not be reached (a network failure, or a 5xx
 * from whatever sits in front of it), the only case the cache stands in for. An answer the
 * server gave (a GraphQL error, a 401) is never replaced with cached data.
 */
export function isServerUnreachable(err: unknown): boolean {
  return !(err instanceof ClientError && err.response.status < 500);
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

// The cache key failing (on Linux: no desktop keyring service, or a locked one) turns the
// cache off for the whole run (the backend keeps the failure, so a dismissed unlock prompt is
// not shown again), so it is said once rather than only logged.
let keyErrorShown = false;

async function invokeCache<T>(command: string, args: Record<string, unknown>): Promise<T | null> {
  const result = await safeInvoke<T>(command, args);
  if (result.ok) return result.value;
  if (result.error.kind !== "ipc_unavailable") {
    logger.warn(`[RIM:cache] ${command} failed:`, result.error);
  }
  if (
    result.error.kind === "backend_error" &&
    result.error.code === "CACHE_KEY" &&
    !keyErrorShown
  ) {
    keyErrorShown = true;
    toast.warning("Local message cache is off until RIM restarts", {
      description: result.error.message,
    });
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

// ─── Local search (PR 10) ───────────────────────────────────────────────────

/**
 * A search of the cached messages, operators already parsed (see `localSearch.ts`). Every
 * field narrows the result.
 */
export interface LocalSearchQuery {
  /** Free text: every word matches as a prefix; `"quoted words"` as a phrase. */
  text: string;
  conversationId?: string;
  /** A user id, or a username with or without `@`. */
  from?: string;
  /** RFC 3339: sent strictly before / at or after. */
  before?: string;
  after?: string;
  hasLink?: boolean;
  hasAttachment?: boolean;
}

/** A hit from the local index, in `SearchMessageItem`'s shape minus the conversation's title. */
export interface LocalSearchHit {
  id: string;
  serverId: string;
  conversationId: string;
  threadId: string | null;
  rootMessageId: string | null;
  authorId: string;
  author: MessageItem["author"] | null;
  text: string;
  sentAt: string;
  rank: number;
  /** Escaped HTML with `<mark>` around the matches; `null` without free text. */
  headline: string | null;
}

export interface LocalSearchPage {
  /** Newest first, as the server's `searchMessages`. */
  items: LocalSearchHit[];
  hasMore: boolean;
}

/**
 * A page of hits from the account's local search index, newest first, older than `after`
 * when given. `null` when there is no cache to search.
 */
export function searchCachedMessages(
  account: CacheAccount,
  workspaceId: string,
  query: LocalSearchQuery,
  after: MessageCursor | null,
  limit: number,
): Promise<LocalSearchPage | null> {
  return invokeCache<LocalSearchPage>("message_cache_search", {
    account,
    workspaceId,
    query,
    after,
    limit,
  });
}
