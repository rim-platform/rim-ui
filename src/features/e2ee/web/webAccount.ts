/**
 * The account the web app's encrypted store works for, once this browser is set up for
 * encrypted conversations: the signed-in user, and the principal and device of the browser's
 * device key. Cache calls and encryption commands made with it go to the web backend.
 */

import { useAuthStore } from "../../auth/state/useAuthStore";
import type { CacheAccount } from "../../messages/api/messageCache";

export interface WebAccount extends CacheAccount {
  principalId: string;
  deviceId: string;
  web: true;
}

let current: WebAccount | null = null;

export function isWebAccount(account: CacheAccount): account is WebAccount {
  return (account as Partial<WebAccount>).web === true;
}

/** The web store's account for the signed-in user, or `null` while there is none. */
export function webStoreAccount(): WebAccount | null {
  const userId = useAuthStore.getState().session?.userId;
  return current && current.userId === userId ? current : null;
}

export function setWebStoreAccount(account: WebAccount | null) {
  current = account;
}
