/**
 * The sync loop that keeps the local message cache current (master plan Stage 2, PR 9).
 *
 * The cache decides what to ask for (it keeps each conversation's cursor and whether more
 * changes are pending); this loop only carries requests to the server's `messageChanges` feed
 * and the answers back, until the cache has nothing left to ask:
 *
 *   input = begin(conversations); while (input) input = apply(await feed(input))
 *
 * A sync runs on startup and on every WebSocket (re)connect for the recently viewed
 * conversations, and for one conversation when a real-time message event for it arrives:
 * events carry no version, so they are only a signal to ask the feed. Requests that arrive
 * while a sync runs are coalesced into the next run.
 */

import { useEffect } from "react";

import type { MessageChangesInput } from "../../../core/graphql/generated/schema-types";
import { onWsConnected } from "../../../core/graphql/wsClient";
import { logger } from "../../../core/logger";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { requestArchiveExport } from "../../history-archive/runtime/archiveExport";
import { mlsInputsFor } from "../../e2ee/runtime/feedInputs";
import {
  applyCacheChanges,
  beginCacheSync,
  currentCacheAccount,
  fetchMessageChanges,
  type CacheAccount,
  type ChangeFeed,
  type FeedConversationChanges,
  type MlsSyncNote,
} from "../api/messageCache";

export interface CacheSyncBackend {
  begin(workspaceId: string, conversationIds?: string[]): Promise<MessageChangesInput | null>;
  apply(
    workspaceId: string,
    changes: FeedConversationChanges[],
  ): Promise<MessageChangesInput | null>;
}

/**
 * Feed requests per run. A run that reaches it leaves the rest pending in the cache and
 * resumes shortly after, so a long initial sync never monopolises the connection and a
 * server that kept answering `hasMore` could not spin the loop forever.
 */
export const MAX_ROUNDS_PER_RUN = 200;

/** Run one sync to completion (or to {@link MAX_ROUNDS_PER_RUN}); returns the rounds made. */
export async function runCacheSync(
  backend: CacheSyncBackend,
  feed: ChangeFeed,
  workspaceId: string,
  conversationIds?: string[],
): Promise<{ rounds: number; finished: boolean }> {
  let input = await backend.begin(workspaceId, conversationIds);
  let rounds = 0;
  while (input && rounds < MAX_ROUNDS_PER_RUN) {
    rounds += 1;
    const changes = await feed(input);
    input = await backend.apply(workspaceId, changes);
  }
  return { rounds, finished: input === null };
}

interface SchedulerDeps {
  getAccount: () => CacheAccount | null;
  backendFor: (account: CacheAccount) => CacheSyncBackend;
  feed: ChangeFeed;
  /** Coalesces bursts of signals (a busy channel) into one request. */
  debounceMs: number;
  /** Pause before resuming a run that hit {@link MAX_ROUNDS_PER_RUN}. */
  resumeDelayMs: number;
  /** The account's cache took a sync without errors (the history archive exports after it). */
  onSynced?: (account: CacheAccount) => void;
}

interface Pending {
  all: boolean;
  ids: Set<string>;
  /** Continue the conversations the cache still has pending, and nothing else. */
  resume: boolean;
  running: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

function accountKey(account: CacheAccount | null): string | null {
  return account ? `${account.endpoint}\n${account.userId}` : null;
}

export function createCacheSyncScheduler(deps: SchedulerDeps) {
  const pending = new Map<string, Pending>();

  async function drain(key: string, account: CacheAccount, workspaceId: string) {
    const entry = pending.get(key);
    if (!entry) return;
    entry.timer = null;
    entry.running = true;
    const backend = deps.backendFor(account);
    // The feed call carries whichever session the webview holds now. If the user signed out
    // or switched accounts while it was in flight, its answer is about someone else (a
    // NO_ACCESS for every conversation, say) and must not reach this account's cache.
    const feed: ChangeFeed = async (input) => {
      const changes = await deps.feed(input);
      if (accountKey(deps.getAccount()) !== accountKey(account)) {
        throw new Error("the signed-in account changed during the sync");
      }
      return changes;
    };
    try {
      while (entry.all || entry.resume || entry.ids.size > 0) {
        // Marking no conversations still continues every pending one.
        const ids = entry.all ? undefined : [...entry.ids];
        entry.all = false;
        entry.resume = false;
        entry.ids.clear();
        const { finished } = await runCacheSync(backend, feed, workspaceId, ids);
        if (!finished) {
          setTimeout(() => request(workspaceId, []), deps.resumeDelayMs);
        }
      }
      deps.onSynced?.(account);
    } catch (err) {
      // Offline or signed out: drop what was queued. The next reconnect syncs everything.
      entry.all = false;
      entry.resume = false;
      entry.ids.clear();
      logger.warn("[RIM:cache] sync failed:", err);
    } finally {
      entry.running = false;
    }
  }

  /**
   * Ask for a sync of `conversationIds` in `workspaceId`, or of every recently viewed
   * conversation when omitted. `[]` resumes only what is already pending.
   */
  function request(workspaceId: string, conversationIds?: string[]) {
    const account = deps.getAccount();
    if (!account) return;
    const key = `${accountKey(account)}\n${workspaceId}`;
    let entry = pending.get(key);
    if (!entry) {
      entry = { all: false, ids: new Set(), resume: false, running: false, timer: null };
      pending.set(key, entry);
    }
    if (conversationIds === undefined) {
      entry.all = true;
    } else if (conversationIds.length === 0) {
      entry.resume = true;
    } else {
      for (const id of conversationIds) entry.ids.add(id);
    }
    if (!entry.running && !entry.timer) {
      entry.timer = setTimeout(() => {
        void drain(key, account, workspaceId);
      }, deps.debounceMs);
    }
  }

  return { request };
}

/** Receives what each feed page did in the encrypted conversations it carried. */
export type E2eeNoteHandler = (
  account: CacheAccount,
  workspaceId: string,
  notes: MlsSyncNote[],
) => void;

let e2eeNoteHandler: E2eeNoteHandler | null = null;

/** Set by the encryption runtime, which resolves what a stopped conversation needs. */
export function setE2eeNoteHandler(handler: E2eeNoteHandler | null) {
  e2eeNoteHandler = handler;
}

/**
 * The cache on the Tauri side. Encrypted conversations of a page get their Commits and thread
 * roots fetched first; the cache decrypts their entries while storing the page.
 */
export function tauriBackend(account: CacheAccount): CacheSyncBackend {
  return {
    begin: (workspaceId, conversationIds) => beginCacheSync(account, workspaceId, conversationIds),
    apply: async (workspaceId, changes) => {
      const mls = await mlsInputsFor(account, workspaceId, changes);
      const step = await applyCacheChanges(account, workspaceId, changes, mls);
      if (step && step.e2ee.length > 0) e2eeNoteHandler?.(account, workspaceId, step.e2ee);
      return step?.next ?? null;
    },
  };
}

/**
 * Sync `conversationIds` now and wait for it, outside the scheduler: the client loop an
 * encrypted send or Commit runs first. Returns false when there is no cache.
 */
export async function syncNow(workspaceId: string, conversationIds: string[]): Promise<boolean> {
  const account = currentCacheAccount();
  if (!account) return false;
  await runCacheSync(tauriBackend(account), fetchMessageChanges, workspaceId, conversationIds);
  return true;
}

const scheduler = createCacheSyncScheduler({
  getAccount: currentCacheAccount,
  backendFor: tauriBackend,
  feed: fetchMessageChanges,
  debounceMs: 250,
  resumeDelayMs: 5_000,
  onSynced: requestArchiveExport,
});

/** See {@link createCacheSyncScheduler}'s `request`. A no-op outside the desktop app. */
export function requestCacheSync(workspaceId: string, conversationIds?: string[]) {
  scheduler.request(workspaceId, conversationIds);
}

/** Sync the recently viewed conversations on startup and on every WebSocket (re)connect. */
export function useMessageCacheSync(workspaceId: string | null) {
  const userId = useAuthStore((s) => s.session?.userId);

  useEffect(() => {
    if (!workspaceId || !userId) return;
    requestCacheSync(workspaceId);
    return onWsConnected(() => requestCacheSync(workspaceId));
  }, [workspaceId, userId]);
}
