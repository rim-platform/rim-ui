/**
 * Last-known copies of the lists the app needs to open offline (the user, the workspaces, a
 * workspace's sidebar channels, DMs and members), kept in the encrypted local cache
 * (`src-tauri/src/message_cache/snapshot.rs`).
 *
 * {@link withOfflineSnapshot} wraps a query: each server answer is saved, and when the server
 * cannot be reached the saved copy stands in and the app switches to offline mode. An answer
 * the server gave (a GraphQL error, a 401) is never replaced, the same rule the message cache
 * follows.
 */

import { logger } from "../../../core/logger";
import { safeInvoke } from "../../../core/tauri/safeInvoke";
import {
  currentCacheAccount,
  isServerUnreachable,
  type CacheAccount,
} from "../../messages/api/messageCache";
import { useOfflineStore } from "../state/useOfflineStore";

/** Account-wide kinds take no workspace; the others need one. */
export type SnapshotKind = "me" | "servers" | "joinedChannels" | "inbox" | "members";

interface StoredSnapshot<T> {
  value: T;
  savedAt: number;
}

export async function saveSnapshot(
  account: CacheAccount,
  kind: SnapshotKind,
  workspaceId: string | null,
  value: unknown,
): Promise<void> {
  const result = await safeInvoke<null>("message_cache_snapshot_put", {
    account,
    kind,
    workspaceId,
    value,
  });
  if (!result.ok && result.error.kind !== "ipc_unavailable") {
    logger.warn(`[RIM:offline] saving the ${kind} snapshot failed:`, result.error);
  }
}

export async function loadSnapshot<T>(
  account: CacheAccount,
  kind: SnapshotKind,
  workspaceId: string | null,
): Promise<T | null> {
  const result = await safeInvoke<StoredSnapshot<T> | null>("message_cache_snapshot_get", {
    account,
    kind,
    workspaceId,
  });
  if (result.ok) return result.value?.value ?? null;
  if (result.error.kind !== "ipc_unavailable") {
    logger.warn(`[RIM:offline] reading the ${kind} snapshot failed:`, result.error);
  }
  return null;
}

function sameAccount(a: CacheAccount, b: CacheAccount | null): boolean {
  return b !== null && a.endpoint === b.endpoint && a.userId === b.userId;
}

/**
 * Run `fetch` against the server, saving its answer as the `kind` snapshot; when the server
 * cannot be reached, answer with the saved snapshot instead, if this device has one.
 * Outside the desktop app it is just `fetch`.
 */
export async function withOfflineSnapshot<T>(
  kind: SnapshotKind,
  workspaceId: string | null,
  fetch: () => Promise<T>,
): Promise<T> {
  const account = currentCacheAccount();
  try {
    const value = await fetch();
    // The request carried whichever session the webview held when it left. If the user signed
    // out or switched accounts meanwhile, the answer is not this account's to keep.
    if (account && sameAccount(account, currentCacheAccount())) {
      void saveSnapshot(account, kind, workspaceId, value);
    }
    return value;
  } catch (err) {
    const current = isServerUnreachable(err) ? currentCacheAccount() : null;
    if (current) {
      const saved = await loadSnapshot<T>(current, kind, workspaceId);
      if (saved !== null) {
        // A saved copy is never shown as if it were live: the banner says so, sending is off,
        // and the reconnect loop takes over (useOfflineReconnect.ts).
        useOfflineStore.getState().setOffline(true);
        return saved;
      }
    }
    throw err;
  }
}
