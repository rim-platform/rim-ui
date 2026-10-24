/**
 * The wraps of each account's data key in this browser: one record per account in the
 * `dataKeys` store of `rim-key-identity`, keyed `[endpoint, principalId]`, holding the data key
 * sealed under each way of opening it (base64url of `nonce ‖ ciphertext ‖ tag`):
 *
 * - `passwordWrap`, under the unlock key a password login and the server share give;
 * - `recoveryWrap`, under the recovery phrase's wrap key, on a browser that held the phrase;
 * - `keepWrap`, under the keep key the server holds for a kept session.
 *
 * The record is not sealed: each wrap is. Opening after a login follows the desktop's rule: when
 * neither the password wrap nor any rewrap opens and a recovery wrap exists, it answers
 * {@link NeedsRecoveryError} and changes nothing, until the person enters the phrase or chooses
 * to start empty.
 */

import {
  committed,
  DATA_KEYS,
  done,
  keyIdentityDatabase,
  storedEndpoint,
  writing,
} from "../../features/key-identity/browser/keyStore";
import { exclusive } from "../../features/key-identity/browser/persistence";
import {
  fromB64,
  randomKey,
  recoveryWrapKey,
  toB64,
  unwrapDataKey,
  unwrapRewrap,
  wrapDataKey,
  type WrapKind,
} from "./crypto";

/** One account's wraps, as stored. */
export interface DataKeyWraps {
  endpoint: string;
  principalId: string;
  passwordWrap: string;
  recoveryWrap?: string;
  keepWrap?: string;
}

/** Nothing this login opens, and the browser holds a recovery wrap: the phrase is needed. */
export const NEEDS_RECOVERY = "NEEDS_RECOVERY";

/**
 * This browser's data for the account opens only with the recovery phrase, or the person
 * chooses to start empty on this browser.
 */
export class NeedsRecoveryError extends Error {
  constructor() {
    super("this browser's data for the account needs the recovery phrase");
    this.name = NEEDS_RECOVERY;
  }
}

function key(endpoint: string, principalId: string): IDBValidKey {
  return [storedEndpoint(endpoint), principalId];
}

/**
 * The account's wraps.
 *
 * @returns The wraps, or `null` when this browser has none for the account.
 */
export async function readWraps(endpoint: string, principalId: string) {
  const tx = (await keyIdentityDatabase()).transaction(DATA_KEYS, "readonly");
  const found = (await done(tx.objectStore(DATA_KEYS).get(key(endpoint, principalId)))) as
    DataKeyWraps | undefined;
  return found ?? null;
}

async function putWraps(wraps: DataKeyWraps): Promise<void> {
  const tx = await writing(DATA_KEYS);
  const finished = committed(tx);
  tx.objectStore(DATA_KEYS).put({ ...wraps, endpoint: storedEndpoint(wraps.endpoint) });
  await finished;
}

/** Deletes the account's wraps; deleting what is not there is not an error. */
export async function deleteWraps(endpoint: string, principalId: string): Promise<void> {
  const tx = await writing(DATA_KEYS);
  const finished = committed(tx);
  tx.objectStore(DATA_KEYS).delete(key(endpoint, principalId));
  await finished;
}

/** Runs one change of the wraps at a time, across this origin's tabs. */
function changing<T>(task: () => Promise<T>): Promise<T> {
  return exclusive("rim-data-key-wraps", task);
}

async function wrap(key: Uint8Array, kind: WrapKind, principalId: string, dataKey: Uint8Array) {
  return toB64(await wrapDataKey(key, kind, principalId, dataKey));
}

async function tryUnwrap(
  key: Uint8Array,
  kind: WrapKind,
  principalId: string,
  wrapped: string,
): Promise<Uint8Array | null> {
  try {
    return await unwrapDataKey(key, kind, principalId, fromB64(wrapped, "a data key wrap"));
  } catch {
    return null;
  }
}

/**
 * The data key the password wrap holds, opened with `unlockKey` or with an older unlock key
 * reached through `rewraps` (each holds the unlock key before a password change, sealed under
 * the one after it).
 */
async function openPasswordWrap(
  unlockKey: Uint8Array,
  principalId: string,
  passwordWrap: string,
  rewraps: string[],
): Promise<Uint8Array | null> {
  const sealed = rewraps.flatMap((r) => {
    try {
      return [fromB64(r, "a rewrap")];
    } catch {
      return [];
    }
  });
  const keys = [unlockKey];
  const used = sealed.map(() => false);
  try {
    for (let next = 0; next < keys.length; next++) {
      const opened = await tryUnwrap(keys[next], "password", principalId, passwordWrap);
      if (opened) return opened;
      for (const [i, rewrap] of sealed.entries()) {
        if (used[i]) continue;
        try {
          keys.push(await unwrapRewrap(keys[next], principalId, rewrap));
          used[i] = true;
        } catch {
          // Sealed under another unlock key.
        }
      }
    }
    return null;
  } finally {
    for (const older of keys.slice(1)) older.fill(0);
  }
}

/** What an unlock opened. */
export interface OpenedDataKey {
  /** The account's data key; the caller wipes it. */
  dataKey: Uint8Array;
  /** The data key is new: what was sealed under an earlier one no longer opens. */
  startedEmpty: boolean;
}

/**
 * Opens the account's data key after a password login, and wraps it under the current unlock
 * key. A data key `held` already (unlocked with the recovery phrase) is used when no wrap opens.
 * The keep wrap goes: a kept session writes a new one with its own keep key.
 *
 * @param unlockKey - The unlock key of this login's export key and the server share.
 * @param rewraps - The server's rewraps of older unlock keys.
 * @param startEmpty - Start over with a new data key when nothing opens although a recovery
 *   wrap exists.
 * @throws NeedsRecoveryError when nothing opens, a recovery wrap exists and `startEmpty` is
 *   false; nothing is changed then. With `startEmpty`, or with no recovery wrap, the account
 *   starts over in this browser with a new data key.
 */
export function openAfterLogin(
  endpoint: string,
  principalId: string,
  unlockKey: Uint8Array,
  rewraps: string[],
  { startEmpty = false, held = null }: { startEmpty?: boolean; held?: Uint8Array | null } = {},
): Promise<OpenedDataKey> {
  return changing(async () => {
    const stored = await readWraps(endpoint, principalId);
    let opened = stored
      ? await openPasswordWrap(unlockKey, principalId, stored.passwordWrap, rewraps)
      : null;
    if (!opened && held) opened = new Uint8Array(held);
    if (!opened && stored?.recoveryWrap && !startEmpty) throw new NeedsRecoveryError();
    const dataKey = opened ?? randomKey();
    const next: DataKeyWraps = {
      ...(opened && stored ? stored : {}),
      endpoint,
      principalId,
      passwordWrap: await wrap(unlockKey, "password", principalId, dataKey),
    };
    delete next.keepWrap;
    await putWraps(next);
    return { dataKey, startedEmpty: !opened };
  });
}

/**
 * Makes the data key of a new account: wrapped under the unlock key of the signup's export key
 * and the server share, and under the recovery phrase when its entropy is given. Replaces any
 * wraps the account had here.
 *
 * @returns The new data key; the caller wipes it.
 */
export function wrapsAfterSignup(
  endpoint: string,
  principalId: string,
  unlockKey: Uint8Array,
  recoveryEntropy: Uint8Array | null,
): Promise<Uint8Array> {
  return changing(async () => {
    const dataKey = randomKey();
    const next: DataKeyWraps = {
      endpoint,
      principalId,
      passwordWrap: await wrap(unlockKey, "password", principalId, dataKey),
    };
    if (recoveryEntropy) {
      const recoveryKey = await recoveryWrapKey(recoveryEntropy);
      next.recoveryWrap = await wrap(recoveryKey, "recovery", principalId, dataKey);
      recoveryKey.fill(0);
    }
    await putWraps(next);
    return dataKey;
  });
}

/**
 * Opens the account's data key with its recovery phrase's entropy.
 *
 * @returns The data key, or `null` when this browser has no recovery wrap for the account or the
 *   phrase does not open it.
 */
export async function openWithRecovery(
  endpoint: string,
  principalId: string,
  entropy: Uint8Array,
): Promise<Uint8Array | null> {
  const wrapped = (await readWraps(endpoint, principalId))?.recoveryWrap;
  if (!wrapped) return null;
  const recoveryKey = await recoveryWrapKey(entropy);
  try {
    return await tryUnwrap(recoveryKey, "recovery", principalId, wrapped);
  } finally {
    recoveryKey.fill(0);
  }
}

/**
 * Wraps the account's data key under its recovery phrase too, on a browser that now holds the
 * phrase.
 */
export function addRecoveryWrap(
  endpoint: string,
  principalId: string,
  dataKey: Uint8Array,
  entropy: Uint8Array,
): Promise<void> {
  return changing(async () => {
    const stored = await readWraps(endpoint, principalId);
    if (!stored) throw new Error("this browser has no data key wraps for that account");
    const recoveryKey = await recoveryWrapKey(entropy);
    try {
      await putWraps({
        ...stored,
        recoveryWrap: await wrap(recoveryKey, "recovery", principalId, dataKey),
      });
    } finally {
      recoveryKey.fill(0);
    }
  });
}

/**
 * Opens the account's data key with the keep key of its kept session.
 *
 * @returns The data key, or `null` when the account is not kept here or the key does not open it.
 */
export async function openKept(
  endpoint: string,
  principalId: string,
  keepKey: Uint8Array,
): Promise<Uint8Array | null> {
  const wrapped = (await readWraps(endpoint, principalId))?.keepWrap;
  return wrapped ? tryUnwrap(keepKey, "keep", principalId, wrapped) : null;
}

/** Wraps the account's data key under the keep key of its kept session. */
export function setKeepWrap(
  endpoint: string,
  principalId: string,
  dataKey: Uint8Array,
  keepKey: Uint8Array,
): Promise<void> {
  return changing(async () => {
    const stored = await readWraps(endpoint, principalId);
    if (!stored) throw new Error("this browser has no data key wraps for that account");
    await putWraps({ ...stored, keepWrap: await wrap(keepKey, "keep", principalId, dataKey) });
  });
}

/** Drops the account's keep wrap, so a keep key the server forgets cannot be replayed. */
export function dropKeepWrap(endpoint: string, principalId: string): Promise<void> {
  return changing(async () => {
    const stored = await readWraps(endpoint, principalId);
    if (!stored?.keepWrap) return;
    const next = { ...stored };
    delete next.keepWrap;
    await putWraps(next);
  });
}
