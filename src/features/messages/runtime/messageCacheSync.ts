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
import {
  applyCacheChanges,
  beginCacheSync,
  currentCacheAccount,
  fetchMessageChanges,
  type CacheAccount,
  type ChangeFeed,
  type FeedConversationChanges,
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
}

interface Pending {
  all: boolean;
  ids: Set<string>;
  /** Continue the conversations the cache still has pending, and nothing else. */
  resume: boolean;
  running: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

export function createCacheSyncScheduler(deps: SchedulerDeps) {
  const pending = new Map<string, Pending>();

  async function drain(key: string, account: CacheAccount, workspaceId: string) {
    const entry = pending.get(key);
    if (!entry) return;
    entry.timer = null;
    entry.running = true;
    const backend = deps.backendFor(account);
    try {
      while (entry.all || entry.resume || entry.ids.size > 0) {
        // Marking no conversations still continues every pending one.
        const ids = entry.all ? undefined : [...entry.ids];
        entry.all = false;
        entry.resume = false;
        entry.ids.clear();
        const { finished } = await runCacheSync(backend, deps.feed, workspaceId, ids);
        if (!finished) {
          setTimeout(() => request(workspaceId, []), deps.resumeDelayMs);
        }
      }
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
    const key = `${account.endpoint}\n${account.userId}\n${workspaceId}`;
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

function tauriBackend(account: CacheAccount): CacheSyncBackend {
  return {
    begin: (workspaceId, conversationIds) => beginCacheSync(account, workspaceId, conversationIds),
    apply: (workspaceId, changes) => applyCacheChanges(account, workspaceId, changes),
  };
}

const scheduler = createCacheSyncScheduler({
  getAccount: currentCacheAccount,
  backendFor: tauriBackend,
  feed: fetchMessageChanges,
  debounceMs: 250,
  resumeDelayMs: 5_000,
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
