/**
 * Who this desktop is for end-to-end encryption: the signed-in account's cache database and
 * the device key this computer holds for it. Without a confirmed device key (a password-only
 * sign-in, or the web app) the device cannot take part in encrypted conversations.
 */

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

function accountKey(account: CacheAccount): string {
  return `${account.endpoint}\n${account.userId}`;
}

/** This device's session, or `null` when it cannot use end-to-end encryption. */
export function e2eeSession(): Promise<E2eeSession | null> {
  const account = currentCacheAccount();
  if (!account) return Promise.resolve(null);
  const key = accountKey(account);
  if (cached?.key !== key || Date.now() - cached.at > SESSION_TTL_MS) {
    cached = {
      key,
      at: Date.now(),
      session: tauriKeyBackend
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
        .catch(() => null),
    };
  }
  return cached.session;
}

/** Forget the resolved session (the keys changed: a link, a recovery, a sign-out). */
export function resetE2eeSession() {
  cached = null;
}
