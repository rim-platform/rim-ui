/**
 * Changing the account password: a change while signed in and a reset with the recovery phrase
 * while signed out.
 */

import { isTauri } from "@tauri-apps/api/core";

import { toB64 } from "../../../core/accountVault/crypto";
import { getGraphqlEndpoint } from "../../../core/graphql/config";
import type { SignedStatementInput } from "../../../core/graphql/generated/schema-types";
import { keyCommand } from "../../key-identity/api/keyBackend";
import { signPasswordReset } from "../../key-identity/browser/recoveryKit";
import {
  passwordChangeFinish,
  passwordChangeStart,
  passwordLoginFinish,
  passwordLoginStart,
  passwordResetChallenge,
  passwordResetFinish,
  passwordResetStart,
} from "../api/passwordApi";
import { changeRewrap, startLogin, startRegistration } from "./opaqueFlows";

/**
 * Changes the signed-in account's password. A login with the current password opens the server
 * share, which both unlock keys need; the change itself checks the current password again and
 * registers the new one, leaving at the server the old unlock key sealed under the new one, so
 * other devices still open their data with the new password. This device's data key is then
 * wrapped under the new unlock key. The account's other sessions end.
 *
 * @throws WrongPasswordError when the current password is wrong, and PasswordLockedError or
 *   PasswordWaitError as a sign-in does.
 */
export async function changePassword(
  principalId: string,
  current: string,
  next: string,
): Promise<void> {
  const login = await startLogin(current);
  const check = await startLogin(current);
  const registration = await startRegistration(next);
  try {
    const started = await passwordLoginStart(principalId, login.request);
    const finished = await passwordLoginFinish(
      started.loginId,
      await login.finish(started.response),
    );
    const change = await passwordChangeStart(check.request, registration.request);
    const credentialFinalization = await check.finish(change.credentialResponse);
    const registrationUpload = await registration.finish(change.registrationResponse);
    const rewrap = await changeRewrap(principalId, login, finished.serverShare, registration);
    try {
      await passwordChangeFinish({
        loginId: change.loginId,
        credentialFinalization,
        registrationUpload,
        rewrap: rewrap.rewrap,
      });
    } catch (err) {
      rewrap.discard();
      throw err;
    }
    await rewrap.commit();
  } finally {
    login.close();
    check.close();
    registration.close();
  }
}

/** A `password-reset` statement signed by the recovery key of the phrase's `entropy`. */
function signReset(
  principalId: string,
  entropy: Uint8Array,
  challenge: { challengeId: string; nonce: string },
): Promise<SignedStatementInput> {
  const endpoint = getGraphqlEndpoint();
  if (isTauri()) {
    return keyCommand<SignedStatementInput>("key_identity_sign_password_reset", {
      endpoint,
      principalId,
      entropy: toB64(entropy),
      challenge,
    });
  }
  return signPasswordReset(endpoint, principalId, entropy, challenge);
}

/**
 * Sets a new password with the recovery phrase, signed out: the recovery key signs a
 * `password-reset` statement and the new password replaces the old one. Every session of the
 * account ends, and the password's 10-try lock goes. Devices whose data was wrapped under the
 * old password ask once for the recovery phrase, or start empty.
 *
 * @param entropy - The recovery phrase's 16 bytes.
 */
export async function resetPassword(
  principalId: string,
  entropy: Uint8Array,
  password: string,
): Promise<void> {
  const challenge = await passwordResetChallenge(principalId);
  const statement = await signReset(principalId, entropy, challenge);
  const registration = await startRegistration(password);
  try {
    const started = await passwordResetStart(statement, registration.request);
    const upload = await registration.finish(started.registrationResponse);
    await passwordResetFinish(started.resetId, upload);
  } finally {
    registration.close();
  }
}
