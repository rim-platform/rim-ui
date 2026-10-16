/**
 * Who this device is for end-to-end encryption: on the desktop, the signed-in account's cache
 * database and the device key this computer holds for it; in the web app, this browser's
 * encrypted store and its device key. Without a confirmed device key (a password-only sign-in,
 * or a browser that is not a linked device) the device cannot take part in encrypted
 * conversations.
 */

import { isTauri } from "@tauri-apps/api/core";

import { getGraphqlEndpoint } from "../../../core/graphql/config";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { tauriKeyBackend } from "../../key-identity/api/keyBackend";
import { currentCacheAccount, type CacheAccount } from "../../messages/api/messageCache";

export interface E2eeSession {
  account: CacheAccount;
  userId: string;
  principalId: string;
  deviceId: string;
}

/** The keys can change under a signed-in account (a recovery, a link): look again after this. */
const SESSION_TTL_MS = 60_000;

let cached: { key: string; at: number; session: Promise<E2eeSession | null> } | null = null;

function desktopSession(account: CacheAccount): Promise<E2eeSession | null> {
  return tauriKeyBackend
    .accounts(account.endpoint)
    .then((accounts) => {
      const mine = accounts.find((a) => a.userId === account.userId && a.confirmed);
      if (!mine) return null;
      return {
        account,
        userId: account.userId,
        principalId: mine.principalId,
        deviceId: mine.deviceId,
      };
    })
    .catch(() => null);
}

async function webSession(endpoint: string, userId: string): Promise<E2eeSession | null> {
  const { resolveWebSession } = await import("../web/webSession");
  const { account } = await resolveWebSession(endpoint, userId);
  if (!account) return null;
  return { account, userId, principalId: account.principalId, deviceId: account.deviceId };
}

/** This device's session, or `null` when it cannot use end-to-end encryption. */
export function e2eeSession(): Promise<E2eeSession | null> {
  const desktop = isTauri();
  const account = desktop ? currentCacheAccount() : null;
  const userId = desktop ? account?.userId : useAuthStore.getState().session?.userId;
  if (!userId) return Promise.resolve(null);
  const endpoint = account?.endpoint ?? getGraphqlEndpoint();
  const key = `${endpoint}\n${userId}`;
  if (cached?.key !== key || Date.now() - cached.at > SESSION_TTL_MS) {
    cached = {
      key,
      at: Date.now(),
      session: account ? desktopSession(account) : webSession(endpoint, userId).catch(() => null),
    };
  }
  return cached.session;
}

/** Forget the resolved session (the keys changed: a link, a recovery, a sign-out). */
export function resetE2eeSession() {
  cached = null;
}

const keysChangedListeners = new Set<() => void>();

/**
 * This device's keys changed in a running session (an enrollment, a link): forget the resolved
 * session and tell whoever listens, so the device sets itself up for encryption now.
 */
export function deviceKeysChanged() {
  resetE2eeSession();
  for (const listener of keysChangedListeners) listener();
}

/** Calls `listener` on every `deviceKeysChanged`; returns the unsubscribe. */
export function onDeviceKeysChanged(listener: () => void): () => void {
  keysChangedListeners.add(listener);
  return () => {
    keysChangedListeners.delete(listener);
  };
}
