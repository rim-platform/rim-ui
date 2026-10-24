/**
 * The desktop's account lock (`src-tauri/src/account_lock`): the password's OPAQUE flows, run
 * in Rust so the export key and the session key never reach the webview, and the unlocking of
 * each account's data key.
 *
 * A flow's start returns a handle and the message to send; its finish keeps the keys under the
 * handle, and one unlock command then uses them. A handle lasts two minutes and serves once.
 * Bytes travel as unpadded base64url. Every call throws its `SafeInvokeError` on failure (a
 * wrong password is the backend code `WRONG_PASSWORD`, a spent or expired handle `NO_HANDLE`),
 * and `ipc_unavailable` in the web app.
 */

import { safeInvoke } from "../../../core/tauri/safeInvoke";

/** A started flow: its handle and the OPAQUE request to send. */
export interface OpaqueFlowStart {
  handle: string;
  request: string;
}

/** An unlocked account. */
export interface UnlockedAccount {
  /** The key (base64url) that seals the account's IndexedDB records. */
  webStoreKey: string;
  /** The data key is new: what was kept under an earlier one no longer opens. */
  startedEmpty: boolean;
}

async function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  const result = await safeInvoke<T>(command, args);
  if (!result.ok) throw result.error;
  return result.value;
}

/**
 * Starts registering a password.
 *
 * @param password - The new password.
 * @returns The handle and the `RegistrationRequest`.
 */
export function opaqueRegistrationStart(password: string): Promise<OpaqueFlowStart> {
  return call("opaque_registration_start", { password });
}

/**
 * Finishes a registration; the export key stays under the handle.
 *
 * @param handle - The handle of {@link opaqueRegistrationStart}.
 * @param response - The server's `RegistrationResponse`.
 * @returns The `RegistrationUpload` to send.
 */
export function opaqueRegistrationFinish(
  handle: string,
  response: string,
): Promise<{ upload: string }> {
  return call("opaque_registration_finish", { handle, response });
}

/**
 * Starts a login with the password.
 *
 * @param password - The password typed.
 * @returns The handle and the `CredentialRequest`.
 */
export function opaqueLoginStart(password: string): Promise<OpaqueFlowStart> {
  return call("opaque_login_start", { password });
}

/**
 * Finishes a login; the export key and the session key stay under the handle.
 *
 * @param handle - The handle of {@link opaqueLoginStart}.
 * @param response - The server's `CredentialResponse`.
 * @returns The `CredentialFinalization` to send.
 */
export function opaqueLoginFinish(
  handle: string,
  response: string,
): Promise<{ finalization: string }> {
  return call("opaque_login_finish", { handle, response });
}

/**
 * Unlocks an account after its login was accepted.
 *
 * @param handle - The handle of the finished login.
 * @param principal - The account's principal id.
 * @param sealedShare - The server share, sealed under the login's transport key.
 * @param rewraps - The server's rewraps of older unlock keys.
 * @param keep - Whether the account stays signed in on this device.
 * @param startEmpty - Whether to start over on this device when nothing opens although it holds
 *   a recovery wrap. Without it that case rejects with `NEEDS_RECOVERY` and the handle stays
 *   usable: unlock with the recovery phrase, then call again, or call again with `startEmpty`.
 */
export function accountUnlockAfterLogin(
  handle: string,
  principal: string,
  sealedShare: string,
  rewraps: string[],
  keep: boolean,
  startEmpty = false,
): Promise<UnlockedAccount> {
  return call("account_unlock_after_login", {
    handle,
    principal,
    sealedShare,
    rewraps,
    keep,
    startEmpty,
  });
}

/**
 * Unlocks a new account after its signup registered the password.
 *
 * @param handle - The handle of the finished registration.
 * @param principal - The account's principal id.
 * @param share - The server share, in the clear.
 * @param recoveryEntropy - The recovery phrase's 16 bytes, when this device holds them.
 * @param keep - Whether the account stays signed in on this device.
 */
export function accountUnlockAfterSignup(
  handle: string,
  principal: string,
  share: string,
  recoveryEntropy: string | null,
  keep: boolean,
): Promise<UnlockedAccount> {
  return call("account_unlock_after_signup", {
    handle,
    principal,
    share,
    recoveryEntropy,
    keep,
  });
}

/**
 * Unlocks a kept account without the server.
 *
 * @param principal - The account's principal id.
 * @returns The unlocked account, or `null` when it is not kept on this device.
 */
export function accountUnlockKept(principal: string): Promise<UnlockedAccount | null> {
  return call("account_unlock_kept", { principal });
}

/**
 * Unlocks an account with its recovery phrase.
 *
 * @param principal - The account's principal id.
 * @param entropy - The phrase's 16 bytes.
 * @returns The unlocked account, or `null` when this device has no recovery wrap for it or the
 *   phrase does not open it.
 */
export function accountUnlockWithRecovery(
  principal: string,
  entropy: string,
): Promise<UnlockedAccount | null> {
  return call("account_unlock_with_recovery", { principal, entropy });
}

/**
 * Locks an account: its data key leaves memory and its message cache closes.
 *
 * @param principal - The account's principal id.
 */
export function accountLock(principal: string): Promise<null> {
  return call("account_lock", { principal });
}

/**
 * Stops keeping an account signed in on this device.
 *
 * @param principal - The account's principal id.
 */
export function accountForgetKeep(principal: string): Promise<null> {
  return call("account_forget_keep", { principal });
}

/**
 * Makes the rewrap of a password change.
 *
 * @param loginHandle - A finished login with the current password.
 * @param sealedShare - The server share that login's `passwordLoginFinish` sealed.
 * @param registrationHandle - The finished registration of the new password; it keeps the new
 *   unlock key for {@link accountPasswordCommit}.
 * @param principal - The account's principal id.
 * @returns The rewrap to send with `passwordChangeFinish`.
 */
export function accountPasswordRewrap(
  loginHandle: string,
  sealedShare: string,
  registrationHandle: string,
  principal: string,
): Promise<{ rewrap: string }> {
  return call("account_password_rewrap", {
    loginHandle,
    sealedShare,
    registrationHandle,
    principal,
  });
}

/**
 * Finishes a password change the server took: the data key is wrapped under the new unlock key.
 *
 * @param handle - The registration handle of {@link accountPasswordRewrap}.
 * @param principal - The account's principal id.
 */
export function accountPasswordCommit(handle: string, principal: string): Promise<null> {
  return call("account_password_commit", { handle, principal });
}

/**
 * Wraps the unlocked account's data key under its recovery phrase too.
 *
 * @param principal - The account's principal id.
 * @param entropy - The phrase's 16 bytes, base64url.
 */
export function accountAddRecoveryWrap(principal: string, entropy: string): Promise<null> {
  return call("account_add_recovery_wrap", { principal, entropy });
}
