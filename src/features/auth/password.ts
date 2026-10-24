/**
 * What an account password may be: a PIN of at least 6 digits, or a passphrase of at least 12
 * characters. The server never sees it, so this device is where the rule holds. Also what the
 * password screens say when a sign-in fails or needs the recovery phrase.
 */

import { graphqlErrorMessage } from "../../core/graphql/errors";
import { SignInCancelled } from "../key-identity/api/keyIdentity";
import { parseRecoveryPhrase } from "../key-identity/browser/recoveryKit";
import { PasswordLockedError, PasswordWaitError, WrongPasswordError } from "./api/passwordApi";

/** Which kind of password the person chose. */
export type PasswordKind = "pin" | "passphrase";

/** The shortest PIN, in digits. */
export const PIN_MIN_DIGITS = 6;

/** The shortest passphrase, in characters. */
export const PASSPHRASE_MIN_CHARS = 12;

/** A password being chosen: its kind, and the password typed twice. */
export interface NewPassword {
  kind: PasswordKind;
  password: string;
  repeat: string;
}

/** A new password with nothing typed yet, as a passphrase. */
export const EMPTY_NEW_PASSWORD: NewPassword = { kind: "passphrase", password: "", repeat: "" };

/**
 * What is wrong with a new password, ready to show.
 *
 * @returns The problem, or `null` when the password may be used.
 */
export function newPasswordProblem({ kind, password, repeat }: NewPassword): string | null {
  if (kind === "pin") {
    if (!/^[0-9]*$/.test(password)) return "A PIN has digits only.";
    if (password.length < PIN_MIN_DIGITS) {
      return `A PIN has at least ${PIN_MIN_DIGITS} digits.`;
    }
  } else if ([...password].length < PASSPHRASE_MIN_CHARS) {
    return `A passphrase has at least ${PASSPHRASE_MIN_CHARS} characters.`;
  }
  if (password !== repeat) return "The two entries do not match.";
  return null;
}

/**
 * Whether "Keep me signed in" starts ticked: on the desktop, where the keep key stays in the
 * computer's own credential store, and not in a browser, which others may use.
 *
 * @param desktop - Whether this is the desktop app.
 */
export function keepSignedInByDefault(desktop: boolean): boolean {
  return desktop;
}

/** What the person reads after a change: other devices learn the new password at their next unlock. */
export const PASSWORD_CHANGED_MESSAGE = "Other devices will ask for the new password.";

/** What "Start empty on this device" means, shown before the person confirms it. */
export const START_EMPTY_EXPLANATION =
  "What this device stored for the account is lost: its cached messages and every key except this device's sign-in key. You stay signed in.";

/** Why the recovery phrase is asked for after the password was accepted. */
export const NEEDS_RECOVERY_EXPLANATION =
  "The password was reset on another device, so what this device keeps for the account opens only with your recovery phrase.";

/** The 16 bytes of a typed recovery phrase, or the reason it was refused. */
export async function readPhrase(
  text: string,
): Promise<{ entropy: Uint8Array } | { error: string }> {
  try {
    return { entropy: await parseRecoveryPhrase(text) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `${message.charAt(0).toUpperCase()}${message.slice(1)}.` };
  }
}

/** A message for a failed sign-in, or `null` when there is nothing to say. */
export function signInFailure(err: unknown): string | null {
  if (err instanceof SignInCancelled) return null;
  if (err instanceof WrongPasswordError) return "Wrong password";
  if (err instanceof PasswordWaitError || err instanceof PasswordLockedError) return err.message;
  return graphqlErrorMessage(err, "Signing in failed.");
}
