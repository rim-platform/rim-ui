/**
 * The session record that lets the desktop app open offline (`src-tauri/src/offline_session.rs`).
 *
 * The webview keeps the session cookie; the record, in the OS keyring, says who was signed in
 * to which server, so a cold start that cannot reach the server can still open that account's
 * local cache instead of stopping at sign-in. An explicit sign-out is recorded too, so the
 * next start lands on sign-in even if the server never heard of the sign-out.
 *
 * Everything is best-effort: in the web app, or if the keyring fails, there is no record and
 * the app behaves as before.
 */

import { isTauri } from "@tauri-apps/api/core";

import { getGraphqlEndpoint } from "../../../core/graphql/config";
import { logger } from "../../../core/logger";
import { safeInvoke } from "../../../core/tauri/safeInvoke";
import { useAuthStore } from "../../auth/state/useAuthStore";

export type SessionRecord =
  | { state: "signedIn"; endpoint: string; userId: string }
  | { state: "signedOut"; endpoint: string };

/**
 * The record this run last saved. A sign-out writes the keyring in the background, so a read
 * right after it (the session check that runs once the session is cleared) answers from here
 * rather than the keyring's previous record.
 */
let latest: SessionRecord | null = null;

/** The record for the server the app talks to, or `null` when there is none. */
export async function loadSessionRecord(): Promise<SessionRecord | null> {
  if (!isTauri()) return null;
  if (latest) return latest;
  const result = await safeInvoke<SessionRecord | null>("offline_session_load", {
    endpoint: getGraphqlEndpoint(),
  });
  if (result.ok) return result.value;
  logger.warn("[RIM:offline] reading the session record failed:", result.error);
  return null;
}

export async function saveSessionRecord(record: SessionRecord): Promise<void> {
  if (!isTauri()) return;
  latest = record;
  const result = await safeInvoke<null>("offline_session_save", { record });
  if (!result.ok) {
    logger.warn("[RIM:offline] saving the session record failed:", result.error);
  }
}

/**
 * Keep the record in step with the auth store: every sign-in (login, sign-up, a restored
 * session) records the account, and a cleared session records the sign-out. Returns the
 * unsubscribe function.
 */
export function persistSessionRecord(
  save: (record: SessionRecord) => Promise<void> = saveSessionRecord,
) {
  return useAuthStore.subscribe((state, prev) => {
    const userId = state.session?.userId ?? null;
    const prevUserId = prev.session?.userId ?? null;
    if (userId === prevUserId) return;
    const endpoint = getGraphqlEndpoint();
    void save(userId ? { state: "signedIn", endpoint, userId } : { state: "signedOut", endpoint });
  });
}
