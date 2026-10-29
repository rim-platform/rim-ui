/**
 * The desktop app's encrypted local message cache.
 *
 * Storage lives on the Tauri side (`src-tauri/src/message_cache`): an SQLCipher database per
 * account, keyed in the secret vault. This module is its typed surface plus the one HTTP call it
 * needs, the server's `messageChanges` feed, which runs here because the webview holds the
 * session cookie.
 *
 * Everything is best-effort: in the web app, or if the cache fails, callers get `null` and
 * carry on with the server. The web app keeps the encrypted conversations it follows
 * in its own encrypted store (`features/e2ee/web/`): calls made with its account go there.
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
import { isWebAccount, webStoreAccount } from "../../e2ee/web/webAccount";
import { MESSAGE_FLAG, serverHasCapability } from "../../updater/api/serverCapabilities";

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
 * Where this app keeps the messages of encrypted conversations: the desktop's cache, or the web
 * app's encrypted store once this browser is set up for encrypted conversations.
 */
export function encryptedStoreAccount(): CacheAccount | null {
  return currentCacheAccount() ?? webStoreAccount();
}

function webStore() {
  return import("../../e2ee/web/webCommands").then((m) => m.webMessageStore);
}

/** A web store call that, like the cache, answers `null` when it fails. */
async function inWebStore<T>(what: string, call: () => Promise<T>): Promise<T | null> {
  try {
    return await call();
  } catch (err) {
    logger.warn(`[RIM:e2ee] ${what} failed:`, err);
    return null;
  }
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

/** A conversation's page of the feed, without its changes. */
const MESSAGE_CHANGES_PAGE_FIELDS = `
      conversationId
      status
      cursor
      hasMore
`;

/** One change's fields beside its message. */
const MESSAGE_CHANGE_FIELDS = `
        kind
        version
        editedAt
`;

export const MESSAGE_CHANGES_QUERY = gql`
  query MessageChanges($input: MessageChangesInput!) {
    messageChanges(input: $input) {
      ${MESSAGE_CHANGES_PAGE_FIELDS}
      changes {
        ${MESSAGE_CHANGE_FIELDS}
        message {
          ...MessageWithReactions
          encryption {
            ciphertext
          }
        }
      }
    }
  }
  ${MESSAGE_WITH_REACTIONS}
`;

/** The same with `Message.flagged`, for a server that lists `message_flag`. */
export const MESSAGE_CHANGES_WITH_FLAGS_QUERY = gql`
  query MessageChangesWithFlags($input: MessageChangesInput!) {
    messageChanges(input: $input) {
      ${MESSAGE_CHANGES_PAGE_FIELDS}
      changes {
        ${MESSAGE_CHANGE_FIELDS}
        message {
          ...MessageWithReactions
          flagged
          encryption {
            ciphertext
          }
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
  const document = (await serverHasCapability(MESSAGE_FLAG))
    ? MESSAGE_CHANGES_WITH_FLAGS_QUERY
    : MESSAGE_CHANGES_QUERY;
  const res = await graphqlClient.request<{ messageChanges: FeedConversationChanges[] }>(document, {
    input,
  });
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

/**
 * Remove the desktop cache of `account` from this device: its database is closed and deleted.
 *
 * @throws Error with the Tauri side's message when the files could not be deleted.
 */
export async function removeCachedAccount(account: CacheAccount): Promise<void> {
  const result = await safeInvoke<null>("message_cache_remove_account", { account });
  if (!result.ok) throw new Error(result.error.message);
}

/** Follow a conversation from now on (the user opened it). */
export async function trackConversation(
  account: CacheAccount,
  workspaceId: string,
  conversationId: string,
): Promise<void> {
  if (isWebAccount(account)) {
    await inWebStore("following a conversation", async () =>
      (await webStore()).track(account, workspaceId, conversationId),
    );
    return;
  }
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
  if (isWebAccount(account)) {
    return inWebStore("starting a sync", async () =>
      (await webStore()).begin(account, workspaceId, conversationIds),
    );
  }
  return invokeCache<MessageChangesInput>("message_cache_sync_begin", {
    account,
    workspaceId,
    conversationIds: conversationIds ?? null,
  });
}

/** What an encrypted conversation's feed page needs: its Commits and thread roots. */
export interface MlsSyncInput {
  conversationId: string;
  serverIncarnation?: number | null;
  inGroup?: boolean | null;
  commits: { incarnation: number; epoch: number; message: string }[];
  threadRoots: Record<string, string>;
}

/** Why the cache stopped an encrypted conversation's sync, and what it needs to go on. */
export type MlsStopReason =
  | { kind: "needCommits"; incarnation: number; epoch: number }
  | { kind: "noGroupState"; incarnation: number }
  | { kind: "awaitingReadd"; incarnation: number; epoch: number | null }
  | { kind: "needThreadRoot"; threadId: string };

/** What a feed page did in one encrypted conversation. */
export interface MlsSyncNote {
  conversationId: string;
  stopped: MlsStopReason | null;
  verify: boolean;
  removed: boolean;
  misbehaved: boolean;
  /** Messages decrypted by this page, for local keyword notifications. */
  decrypted: {
    messageId: string;
    authorId: string;
    threadId: string | null;
    sentAt: string;
    body: string;
  }[];
}

export interface CacheSyncStep {
  next: MessageChangesInput | null;
  e2ee: MlsSyncNote[];
}

/**
 * Store a feed answer, decrypting the entries of encrypted conversations with what `mls`
 * hands in for them. `null` when there is no cache.
 */
export function applyCacheChanges(
  account: CacheAccount,
  workspaceId: string,
  changes: FeedConversationChanges[],
  mls: MlsSyncInput[] = [],
): Promise<CacheSyncStep | null> {
  if (isWebAccount(account)) {
    return inWebStore("storing a feed page", async () =>
      (await webStore()).apply(account, workspaceId, changes, mls),
    );
  }
  return invokeCache<CacheSyncStep>("message_cache_sync_apply", {
    account,
    workspaceId,
    changes,
    mls,
  });
}

/** A thread's cached replies after its cached root message (the encrypted thread view). */
export function readCachedThread(
  account: CacheAccount,
  workspaceId: string,
  conversationId: string,
  threadId: string,
  rootMessageId: string | null,
): Promise<MessageItem[] | null> {
  if (isWebAccount(account)) {
    return inWebStore("reading a thread", async () =>
      (await webStore()).thread(account, workspaceId, conversationId, threadId, rootMessageId),
    );
  }
  return invokeCache<MessageItem[]>("message_cache_thread", {
    account,
    workspaceId,
    conversationId,
    threadId,
    rootMessageId,
  });
}

/** One cached message, or `null`. */
export function readCachedMessage(
  account: CacheAccount,
  messageId: string,
): Promise<MessageItem | null> {
  if (isWebAccount(account)) {
    return inWebStore("reading a message", async () =>
      (await webStore()).message(account, messageId),
    );
  }
  return invokeCache<MessageItem | null>("message_cache_message", { account, messageId });
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
  const page = isWebAccount(account)
    ? await inWebStore("reading a timeline", async () =>
        (await webStore()).timeline(account, workspaceId, conversationId, before, limit),
      )
    : await invokeCache<CachedTimelinePage | null>("message_cache_timeline", {
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

// ─── Local search ───────────────────────────────────────────────────────────

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
