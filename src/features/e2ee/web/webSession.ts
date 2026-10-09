/**
 * Whether this browser can take part in encrypted conversations for the signed-in account, and
 * its session when it can: a browser that holds a confirmed device key for the account, runs
 * the MLS module, and is the only tab of this browser doing encryption for the account (two
 * tabs would each advance their own copy of the group state).
 */

import { browserDeviceKeysSupported } from "../../../core/runtime/ed25519";
import { records, storedEndpoint } from "../../key-identity/browser/keyStore";
import { useE2eeStore, type WebEncryption } from "../state/useE2eeStore";
import { loadMls } from "./mlsModule";
import { setWebStoreAccount, type WebAccount } from "./webAccount";
import { openStore } from "./webCommands";

const locks = new Map<string, Promise<boolean>>();

/**
 * Hold this browser's encryption lock for an account while the page lives; `false` while
 * another tab holds it. Without the Web Locks API the page assumes it is alone.
 */
function holdTabLock(name: string): Promise<boolean> {
  const held = locks.get(name);
  if (held) return held;
  const manager = globalThis.navigator?.locks;
  if (!manager) return Promise.resolve(true);
  const taken = new Promise<boolean>((resolve) => {
    void manager.request(name, { ifAvailable: true }, (lock) => {
      resolve(lock !== null);
      // Never settles: the lock is released when the page goes.
      return lock ? new Promise<void>(() => undefined) : undefined;
    });
  });
  locks.set(name, taken);
  void taken.then((ok) => {
    if (!ok) locks.delete(name);
  });
  return taken;
}

export interface WebSessionResult {
  support: WebEncryption;
  account: WebAccount | null;
}

/** Look at this browser for the account and open its encrypted store when it can take part. */
export async function resolveWebSession(
  endpoint: string,
  userId: string,
): Promise<WebSessionResult> {
  const result = await probe(endpoint, userId);
  setWebStoreAccount(result.account);
  useE2eeStore.getState().setWebEncryption(result.support);
  return result;
}

async function probe(endpoint: string, userId: string): Promise<WebSessionResult> {
  const none = (support: WebEncryption) => ({ support, account: null });
  if (!(await browserDeviceKeysSupported())) return none("unsupported");
  const mine = (await records(endpoint).catch(() => [])).find(
    (r) => r.userId === userId && r.confirmed,
  );
  if (!mine) return none("noDeviceKey");
  if (!(await loadMls())) return none("unsupported");
  const at = storedEndpoint(endpoint);
  if (!(await holdTabLock(`rim-e2ee:${at}:${mine.principalId}`))) return none("otherTab");
  const account: WebAccount = {
    endpoint: at,
    userId,
    principalId: mine.principalId,
    deviceId: mine.deviceId.toLowerCase(),
    web: true,
  };
  try {
    await openStore(account);
  } catch {
    return none("unsupported");
  }
  return { support: "ready", account };
}
