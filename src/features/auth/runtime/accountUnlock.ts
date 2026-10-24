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
import {
  fromB64,
  KEY_LEN,
  openTransport,
  rewrapUnlockKey,
  toB64,
} from "../../../core/accountVault/crypto";
import {
  addRecoveryWrap,
  dropKeepWrap,
  NeedsRecoveryError,
  openAfterLogin,
  openKept,
  openWithRecovery,
  replacePasswordWrap,
  setKeepWrap,
  wrapsAfterSignup,
} from "../../../core/accountVault/dkWraps";
import { setSessionSecret } from "../../../core/graphql/sessionSecret";
import { logger } from "../../../core/logger";
import { closeStores } from "../../e2ee/web/webCommands";
import { setWebStoreAccount } from "../../e2ee/web/webAccount";
import { storedEndpoint } from "../../key-identity/browser/keyStore";
import { sealKeysAtUnlock } from "../../key-identity/browser/sealAtRest";
import {
  accountAddRecoveryWrap,
  accountLock,
  accountUnlockAfterLogin,
  accountUnlockAfterSignup,
  accountUnlockKept,
  accountUnlockWithRecovery,
  type UnlockedAccount,
} from "../api/accountLock";
import { loadOpaque } from "../opaque/opaqueModule";
import { clearReloadWindow, keepForReload } from "./reloadWindow";

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

/** Holds the store key the desktop handed over for an unlocked account. */
async function holdDesktop(endpoint: string, principalId: string, unlocked: UnlockedAccount) {
  await unlockVaultWithStoreKey(
    accountOf(endpoint, principalId),
    fromB64(unlocked.webStoreKey, "the store key"),
  );
  return { startedEmpty: unlocked.startedEmpty };
}

/** Whether a desktop command failed with `code`. */
function desktopCode(err: unknown, code: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { kind?: unknown }).kind === "backend_error" &&
    (err as { code?: unknown }).code === code
  );
}

/**
 * Unlocks the account on the desktop after its password login was accepted, as
 * {@link unlockAfterLogin} does in the browser.
 *
 * @param handle - The desktop's handle of the finished login.
 * @param keep - Whether the account stays signed in on this device.
 * @throws NeedsRecoveryError as {@link unlockAfterLogin}; the handle stays usable.
 */
export async function unlockAfterLoginOnDesktop(
  handle: string,
  input: Omit<LoginUnlock, "exportKey" | "sessionKey"> & { keep: boolean },
): Promise<Unlocked> {
  let unlocked: UnlockedAccount;
  try {
    unlocked = await accountUnlockAfterLogin(
      handle,
      input.principalId,
      input.serverShare,
      input.rewraps,
      input.keep,
      input.startEmpty ?? false,
    );
  } catch (err) {
    if (desktopCode(err, "NEEDS_RECOVERY")) throw new NeedsRecoveryError();
    throw err;
  }
  return holdDesktop(input.endpoint, input.principalId, unlocked);
}

/**
 * Unlocks the account on the desktop after a signup registered its password, as
 * {@link unlockAfterSignup} does in the browser. An account unlocked already keeps its data key.
 *
 * @param handle - The desktop's handle of the finished registration.
 * @param keep - Whether the account stays signed in on this device.
 */
export async function unlockAfterSignupOnDesktop(
  handle: string,
  input: Omit<SignupUnlock, "exportKey"> & { keep: boolean },
): Promise<Unlocked> {
  const unlocked = await accountUnlockAfterSignup(
    handle,
    input.principalId,
    input.serverShare,
    input.recoveryEntropy ? toB64(input.recoveryEntropy) : null,
    input.keep,
  );
  return holdDesktop(input.endpoint, input.principalId, unlocked);
}

/**
 * Unlocks the account on the desktop with its recovery phrase, as {@link unlockWithRecovery}
 * does in the browser.
 *
 * @returns Whether it unlocked.
 */
export async function unlockWithRecoveryOnDesktop(
  endpoint: string,
  principalId: string,
  entropy: Uint8Array,
): Promise<boolean> {
  const unlocked = await accountUnlockWithRecovery(principalId, toB64(entropy));
  if (!unlocked) return false;
  await holdDesktop(endpoint, principalId, unlocked);
  return true;
}

/**
 * Wraps the unlocked account's data key under its recovery phrase too, on a device that now
 * holds the phrase.
 *
 * @param entropy - The phrase's 16 bytes.
 * @throws VaultLockedError while nothing is unlocked.
 */
export async function addRecoveryWrapToUnlocked(entropy: Uint8Array): Promise<void> {
  const account = vaultAccount();
  if (!account) throw new Error("no account is unlocked on this device");
  if (isTauri()) {
    await accountAddRecoveryWrap(account.principalId, toB64(entropy));
    return;
  }
  const dataKey = vaultDataKey();
  if (!dataKey) throw new Error("no account is unlocked in this browser");
  try {
    await addRecoveryWrap(account.endpoint, account.principalId, dataKey, entropy);
  } finally {
    dataKey.fill(0);
  }
}

/** What a password change's rewrap takes in the browser. */
export interface ChangeRewrap {
  principalId: string;
  /** The export key of a login with the current password. */
  oldExportKey: Uint8Array;
  /** That login's session key. */
  sessionKey: Uint8Array;
  /** That login's `serverShare`, sealed under its transport key. */
  serverShare: string;
  /** The export key of the new password's registration. */
  newExportKey: Uint8Array;
}

/**
 * Makes the rewrap of a password change in the browser: the old unlock key sealed under the new
 * one, both from the server share the login opened.
 *
 * @returns The rewrap (base64url) for `passwordChangeFinish`, and the new unlock key for
 *   {@link commitPasswordChange}, which the caller wipes.
 */
export async function passwordChangeRewrap(
  input: ChangeRewrap,
): Promise<{ rewrap: string; newUnlockKey: Uint8Array }> {
  const opaque = await loadOpaque();
  const transport = opaque.transportKey(input.sessionKey, "server share");
  let share: Uint8Array;
  try {
    share = share32(await openTransport(transport, input.serverShare));
  } finally {
    transport.fill(0);
  }
  try {
    const oldKey = opaque.unlockKey(input.oldExportKey, share, input.principalId);
    const newUnlockKey = opaque.unlockKey(input.newExportKey, share, input.principalId);
    try {
      const rewrap = toB64(await rewrapUnlockKey(newUnlockKey, oldKey, input.principalId));
      return { rewrap, newUnlockKey };
    } finally {
      oldKey.fill(0);
    }
  } finally {
    share.fill(0);
  }
}

/**
 * Wraps the unlocked account's data key under the new unlock key, once the server took the
 * password change.
 *
 * @throws VaultLockedError while nothing is unlocked.
 */
export async function commitPasswordChange(newUnlockKey: Uint8Array): Promise<void> {
  const account = vaultAccount();
  const dataKey = vaultDataKey();
  if (!account || !dataKey) throw new Error("no account is unlocked in this browser");
  try {
    await replacePasswordWrap(account.endpoint, account.principalId, newUnlockKey, dataKey);
  } finally {
    dataKey.fill(0);
  }
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

/** What a sign-in or signup returned for the session it started. */
export interface SessionKeys {
  /** The session secret of a session signed in without "Keep me signed in". */
  sessionSecret?: string | null;
  /** The keep key the server holds for a kept web session. */
  keepKey?: string | null;
}

/**
 * Holds what a sign-in or signup returned, once the account is unlocked: the session secret,
 * kept for a reload too, or the keep key, which then wraps the data key.
 */
export async function holdSession({ sessionSecret, keepKey }: SessionKeys): Promise<void> {
  if (sessionSecret) {
    setSessionSecret(sessionSecret);
    if (!isTauri()) {
      await keepForReload().catch((err: unknown) =>
        logger.warn("[RIM:auth] keeping the session for a reload failed:", err),
      );
    }
  }
  if (keepKey) await keepUnlocked(fromB64(keepKey, "the keep key"));
}

/**
 * Locks the signed-in account: its keys leave memory, the session secret and what the tab kept
 * for a reload go, the encrypted store closes and forgets its account, and the stores sealed
 * under it go back to their initial state. On the desktop its data key leaves the desktop's
 * memory too; in the web app the keep wrap goes, so a keep key the server forgets cannot be
 * replayed.
 */
export function lockAccount(): void {
  const account = vaultAccount();
  lockVault();
  setSessionSecret(null);
  clearReloadWindow();
  closeStores();
  setWebStoreAccount(null);
  if (account && isTauri()) {
    accountLock(account.principalId).catch((err: unknown) =>
      logger.warn("[RIM:auth] locking the account on this computer failed:", err),
    );
  } else if (account) {
    dropKeepWrap(account.endpoint, account.principalId).catch((err: unknown) =>
      logger.warn("[RIM:auth] dropping the keep wrap failed:", err),
    );
  }
}
