/**
 * Unlocking and locking the signed-in account's data on this device: the web app's counterpart
 * of the desktop's account lock (`src-tauri/src/account_lock`), on the same keys and wraps.
 *
 * Each unlock opens the account's data key (`core/accountVault/dkWraps`), puts it in the
 * account vault, which hydrates what is sealed under it, and then seals the account's key record
 * (`sealKeysAtUnlock`). An unlock after a login or a signup knows the server share, which also
 * wraps the device key. On the desktop the data key stays in the desktop's process and the
 * webview gets the store key alone.
 */

import { isTauri } from "@tauri-apps/api/core";

import {
  lockVault,
  unlockVault,
  unlockVaultWithStoreKey,
  vaultAccount,
  vaultDataKey,
  vaultHolds,
  type VaultAccount,
} from "../../../core/accountVault/accountVault";
import { fromB64, KEY_LEN, openTransport } from "../../../core/accountVault/crypto";
import {
  dropKeepWrap,
  openAfterLogin,
  openKept,
  openWithRecovery,
  setKeepWrap,
  wrapsAfterSignup,
} from "../../../core/accountVault/dkWraps";
import { logger } from "../../../core/logger";
import { closeStores } from "../../e2ee/web/webCommands";
import { setWebStoreAccount } from "../../e2ee/web/webAccount";
import { storedEndpoint } from "../../key-identity/browser/keyStore";
import { sealKeysAtUnlock } from "../../key-identity/browser/sealAtRest";
import { accountUnlockKept } from "../api/accountLock";
import { loadOpaque } from "../opaque/opaqueModule";

/** What an unlock after a password login takes. */
export interface LoginUnlock {
  /** The GraphQL endpoint the account signs in at. */
  endpoint: string;
  principalId: string;
  /** The OPAQUE login's export key, 64 bytes. */
  exportKey: Uint8Array;
  /** The OPAQUE login's session key, 64 bytes. */
  sessionKey: Uint8Array;
  /** `passwordLoginFinish`'s `serverShare`, sealed under the transport key. */
  serverShare: string;
  /** `passwordLoginFinish`'s rewraps of older unlock keys. */
  rewraps: string[];
  /**
   * Start over in this browser when nothing opens although it holds a recovery wrap. Without
   * it, that case throws `NeedsRecoveryError` and changes nothing.
   */
  startEmpty?: boolean;
}

/** What an unlock after a signup takes. */
export interface SignupUnlock {
  endpoint: string;
  principalId: string;
  /** The OPAQUE registration's export key, 64 bytes. */
  exportKey: Uint8Array;
  /** `signupWithKey`'s `serverShare`, in the clear, base64url. */
  serverShare: string;
  /** The recovery phrase's 16 bytes, when this browser holds them. */
  recoveryEntropy: Uint8Array | null;
}

/** An unlocked account. */
export interface Unlocked {
  /** The data key is new: what this browser kept for the account before no longer opens. */
  startedEmpty: boolean;
}

function accountOf(endpoint: string, principalId: string): VaultAccount {
  return { endpoint: storedEndpoint(endpoint), principalId };
}

function share32(share: Uint8Array): Uint8Array {
  if (share.length !== KEY_LEN) throw new Error("the server share must be 32 bytes");
  return share;
}

/** Holds `dataKey` in the vault, then seals the key record; the data key is wiped after. */
async function hold(account: VaultAccount, dataKey: Uint8Array, share: Uint8Array | null) {
  try {
    await unlockVault(account, dataKey);
  } finally {
    dataKey.fill(0);
  }
  await sealKeysAtUnlock(account.endpoint, account.principalId, share);
}

async function unlockKeyOf(
  exportKey: Uint8Array,
  share: Uint8Array,
  principalId: string,
): Promise<Uint8Array> {
  return (await loadOpaque()).unlockKey(exportKey, share, principalId);
}

/**
 * Unlocks the account after its password login was accepted: opens the server share with the
 * login's session key, derives the unlock key, and opens the password wrap with it, or with an
 * older unlock key one of the rewraps holds (then wraps it under the current one). A data key
 * the recovery phrase already unlocked is used when no wrap opens.
 *
 * @throws NeedsRecoveryError when nothing opens, this browser holds a recovery wrap and
 *   `startEmpty` is not set: unlock with the recovery phrase and call again, or call again
 *   with `startEmpty`.
 */
export async function unlockAfterLogin(input: LoginUnlock): Promise<Unlocked> {
  const account = accountOf(input.endpoint, input.principalId);
  const opaque = await loadOpaque();
  const transport = opaque.transportKey(input.sessionKey, "server share");
  let share: Uint8Array;
  try {
    share = share32(await openTransport(transport, input.serverShare));
  } finally {
    transport.fill(0);
  }
  const unlockKey = await unlockKeyOf(input.exportKey, share, account.principalId);
  const held = vaultHolds(account.endpoint, account.principalId) ? vaultDataKey() : null;
  try {
    const opened = await openAfterLogin(
      account.endpoint,
      account.principalId,
      unlockKey,
      input.rewraps,
      { startEmpty: input.startEmpty, held },
    );
    await hold(account, opened.dataKey, share);
    return { startedEmpty: opened.startedEmpty };
  } finally {
    unlockKey.fill(0);
    held?.fill(0);
    share.fill(0);
  }
}

/**
 * Unlocks a new account after its signup registered the password: a new data key, wrapped under
 * the unlock key and, when given, under the recovery phrase. Replaces any wraps the account had
 * in this browser.
 */
export async function unlockAfterSignup(input: SignupUnlock): Promise<Unlocked> {
  const account = accountOf(input.endpoint, input.principalId);
  const share = share32(fromB64(input.serverShare, "the server share"));
  const unlockKey = await unlockKeyOf(input.exportKey, share, account.principalId);
  try {
    const dataKey = await wrapsAfterSignup(
      account.endpoint,
      account.principalId,
      unlockKey,
      input.recoveryEntropy,
    );
    await hold(account, dataKey, share);
    return { startedEmpty: true };
  } finally {
    unlockKey.fill(0);
    share.fill(0);
  }
}

/**
 * Unlocks the account with its recovery phrase, without the server.
 *
 * @param entropy - The phrase's 16 bytes.
 * @returns Whether it unlocked: `false` when this browser has no recovery wrap for the account
 *   or the phrase does not open it.
 */
export async function unlockWithRecovery(
  endpoint: string,
  principalId: string,
  entropy: Uint8Array,
): Promise<boolean> {
  const account = accountOf(endpoint, principalId);
  const dataKey = await openWithRecovery(account.endpoint, principalId, entropy);
  if (!dataKey) return false;
  await hold(account, dataKey, null);
  return true;
}

/**
 * Unlocks a kept account with the keep key its session holds at the server.
 *
 * @returns Whether it unlocked: `false` when the account is not kept in this browser or the key
 *   does not open it.
 */
export async function unlockKept(
  endpoint: string,
  principalId: string,
  keepKey: Uint8Array,
): Promise<boolean> {
  const account = accountOf(endpoint, principalId);
  const dataKey = await openKept(account.endpoint, principalId, keepKey);
  if (!dataKey) return false;
  await hold(account, dataKey, null);
  return true;
}

/**
 * Unlocks a kept account on the desktop, without the server: the desktop opens its keep wrap
 * and hands over the store key.
 *
 * @returns Whether it unlocked: `false` when the account is not kept on this device.
 */
export async function unlockKeptOnDesktop(endpoint: string, principalId: string) {
  const unlocked = await accountUnlockKept(principalId);
  if (!unlocked) return false;
  await unlockVaultWithStoreKey(
    accountOf(endpoint, principalId),
    fromB64(unlocked.webStoreKey, "the store key"),
  );
  return true;
}

/**
 * Keeps the unlocked account signed in on this browser: wraps its data key under the keep key
 * its kept session holds at the server.
 *
 * @throws VaultLockedError while nothing is unlocked.
 */
export async function keepUnlocked(keepKey: Uint8Array): Promise<void> {
  const account = vaultAccount();
  const dataKey = vaultDataKey();
  if (!account || !dataKey) throw new Error("no account is unlocked in this browser");
  try {
    await setKeepWrap(account.endpoint, account.principalId, dataKey, keepKey);
  } finally {
    dataKey.fill(0);
  }
}

/**
 * Locks the signed-in account: its keys leave memory, the encrypted store closes and forgets its
 * account, and the stores sealed under it go back to their initial state. In the web app the
 * keep wrap goes too, so a keep key the server forgets cannot be replayed.
 */
export function lockAccount(): void {
  const account = vaultAccount();
  lockVault();
  closeStores();
  setWebStoreAccount(null);
  if (account && !isTauri()) {
    dropKeepWrap(account.endpoint, account.principalId).catch((err: unknown) =>
      logger.warn("[RIM:auth] dropping the keep wrap failed:", err),
    );
  }
}
