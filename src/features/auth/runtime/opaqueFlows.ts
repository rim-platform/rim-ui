/**
 * The password's OPAQUE flows on either platform, behind one shape: in the web app the
 * WebAssembly module runs them and the export key and session key stay in this module until the
 * unlock that uses them; on the desktop the Tauri side runs them behind a handle and the keys
 * never reach the webview. Each flow starts with the password, sends its request, finishes with
 * the server's response, and then serves the unlock (or the password change's rewrap) that
 * follows. Messages travel as unpadded base64url.
 */

import { isTauri } from "@tauri-apps/api/core";

import { fromB64, toB64 } from "../../../core/accountVault/crypto";
import {
  accountPasswordCommit,
  accountPasswordRewrap,
  opaqueLoginFinish,
  opaqueLoginStart,
  opaqueRegistrationFinish,
  opaqueRegistrationStart,
} from "../api/accountLock";
import { WrongPasswordError } from "../api/passwordApi";
import {
  loadOpaque,
  opaqueCode,
  type OpaqueLogin,
  type OpaqueRegistration,
} from "../opaque/opaqueModule";
import {
  commitPasswordChange,
  passwordChangeRewrap,
  unlockAfterLogin,
  unlockAfterLoginOnDesktop,
  unlockAfterSignup,
  unlockAfterSignupOnDesktop,
  type Unlocked,
} from "./accountUnlock";

/** What an unlock after a login takes besides the flow. */
export interface LoginUnlockInput {
  endpoint: string;
  principalId: string;
  /** `passwordLoginFinish`'s `serverShare`, sealed under the transport key. */
  serverShare: string;
  rewraps: string[];
  /** Whether the account stays signed in on this device. */
  keep: boolean;
  /** Start over on this device when nothing opens although it holds a recovery wrap. */
  startEmpty?: boolean;
}

/** What an unlock after a registration takes besides the flow. */
export interface SignupUnlockInput {
  endpoint: string;
  principalId: string;
  /** The server share in the clear, as `signupWithKey` or `setPassword` returned it. */
  serverShare: string;
  /** The recovery phrase's 16 bytes, when this device holds them. */
  recoveryEntropy: Uint8Array | null;
  /** Whether the account stays signed in on this device. */
  keep: boolean;
}

/** A started registration of a new password. */
export interface PasswordRegistration {
  /** The OPAQUE `RegistrationRequest` to send. */
  readonly request: string;
  /**
   * Finishes with the server's `RegistrationResponse`.
   *
   * @returns The `RegistrationUpload` to send.
   */
  finish(response: string): Promise<string>;
  /** Unlocks the account the registration was for, once the server stored it. */
  unlockAfterSignup(input: SignupUnlockInput): Promise<Unlocked>;
  /** Wipes what the flow holds. */
  close(): void;
}

/** A started login with a password. */
export interface PasswordLogin {
  /** The OPAQUE `CredentialRequest` to send. */
  readonly request: string;
  /**
   * Finishes with the server's `CredentialResponse`.
   *
   * @returns The `CredentialFinalization` to send.
   * @throws WrongPasswordError when the password is wrong.
   */
  finish(response: string): Promise<string>;
  /**
   * Unlocks the account once the server accepted the login.
   *
   * @throws NeedsRecoveryError when this device's data for the account needs the recovery
   *   phrase; the flow stays usable for another unlock.
   */
  unlock(input: LoginUnlockInput): Promise<Unlocked>;
  /** Wipes what the flow holds. */
  close(): void;
}

/** A password change's rewrap, and the step that applies it on this device. */
export interface ChangeRewrapResult {
  /** The old unlock key sealed under the new one, for `passwordChangeFinish`. */
  rewrap: string;
  /** Wraps this device's data key under the new unlock key, once the server took the change. */
  commit(): Promise<void>;
  /** Wipes the new unlock key when the change did not go through. */
  discard(): void;
}

function wipe(bytes: Uint8Array | null) {
  bytes?.fill(0);
}

function wrongPassword(err: unknown): boolean {
  if (opaqueCode(err) === "OPAQUE_WRONG_PASSWORD") return true;
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { kind?: unknown }).kind === "backend_error" &&
    (err as { code?: unknown }).code === "WRONG_PASSWORD"
  );
}

class WebRegistration implements PasswordRegistration {
  readonly request: string;
  private flow: OpaqueRegistration | null;
  exportKey: Uint8Array | null = null;

  constructor(flow: OpaqueRegistration) {
    this.flow = flow;
    this.request = toB64(flow.request());
  }

  async finish(response: string): Promise<string> {
    if (!this.flow) throw new Error("this registration already finished");
    const finished = this.flow.finish(fromB64(response, "the registration response"));
    this.exportKey = finished.exportKey;
    return toB64(finished.upload);
  }

  async unlockAfterSignup(input: SignupUnlockInput): Promise<Unlocked> {
    if (!this.exportKey) throw new Error("the registration did not finish");
    return unlockAfterSignup({ ...input, exportKey: this.exportKey });
  }

  close() {
    this.flow?.free();
    this.flow = null;
    wipe(this.exportKey);
    this.exportKey = null;
  }
}

class WebLogin implements PasswordLogin {
  readonly request: string;
  private flow: OpaqueLogin | null;
  exportKey: Uint8Array | null = null;
  sessionKey: Uint8Array | null = null;

  constructor(flow: OpaqueLogin) {
    this.flow = flow;
    this.request = toB64(flow.request());
  }

  async finish(response: string): Promise<string> {
    if (!this.flow) throw new Error("this login already finished");
    try {
      const finished = this.flow.finish(fromB64(response, "the credential response"));
      this.exportKey = finished.exportKey;
      this.sessionKey = finished.sessionKey;
      return toB64(finished.finalization);
    } catch (err) {
      if (wrongPassword(err)) throw new WrongPasswordError();
      throw err;
    }
  }

  async unlock(input: LoginUnlockInput): Promise<Unlocked> {
    if (!this.exportKey || !this.sessionKey) throw new Error("the login did not finish");
    return unlockAfterLogin({
      endpoint: input.endpoint,
      principalId: input.principalId,
      exportKey: this.exportKey,
      sessionKey: this.sessionKey,
      serverShare: input.serverShare,
      rewraps: input.rewraps,
      startEmpty: input.startEmpty,
    });
  }

  close() {
    this.flow?.free();
    this.flow = null;
    wipe(this.exportKey);
    wipe(this.sessionKey);
    this.exportKey = null;
    this.sessionKey = null;
  }
}

class DesktopRegistration implements PasswordRegistration {
  constructor(
    readonly handle: string,
    readonly request: string,
  ) {}

  async finish(response: string): Promise<string> {
    return (await opaqueRegistrationFinish(this.handle, response)).upload;
  }

  unlockAfterSignup(input: SignupUnlockInput): Promise<Unlocked> {
    return unlockAfterSignupOnDesktop(this.handle, input);
  }

  close() {}
}

class DesktopLogin implements PasswordLogin {
  constructor(
    readonly handle: string,
    readonly request: string,
  ) {}

  async finish(response: string): Promise<string> {
    try {
      return (await opaqueLoginFinish(this.handle, response)).finalization;
    } catch (err) {
      if (wrongPassword(err)) throw new WrongPasswordError();
      throw err;
    }
  }

  unlock(input: LoginUnlockInput): Promise<Unlocked> {
    return unlockAfterLoginOnDesktop(this.handle, input);
  }

  close() {}
}

/**
 * Starts registering `password`: at a signup, a password change, a reset or setting a first one.
 *
 * @returns The started flow; the caller closes it.
 */
export async function startRegistration(password: string): Promise<PasswordRegistration> {
  if (isTauri()) {
    const started = await opaqueRegistrationStart(password);
    return new DesktopRegistration(started.handle, started.request);
  }
  const opaque = await loadOpaque();
  return new WebRegistration(new opaque.OpaqueRegistration(password));
}

/**
 * Starts a login with `password`.
 *
 * @returns The started flow; the caller closes it.
 */
export async function startLogin(password: string): Promise<PasswordLogin> {
  if (isTauri()) {
    const started = await opaqueLoginStart(password);
    return new DesktopLogin(started.handle, started.request);
  }
  const opaque = await loadOpaque();
  return new WebLogin(new opaque.OpaqueLogin(password));
}

/**
 * Makes the rewrap of a password change from a finished login with the current password, the
 * server share it sealed, and a finished registration of the new password.
 *
 * @param login - A flow of {@link startLogin}, finished and accepted by the server.
 * @param serverShare - That login's sealed `serverShare`.
 * @param registration - A flow of {@link startRegistration}, finished.
 */
export async function changeRewrap(
  principalId: string,
  login: PasswordLogin,
  serverShare: string,
  registration: PasswordRegistration,
): Promise<ChangeRewrapResult> {
  if (login instanceof DesktopLogin && registration instanceof DesktopRegistration) {
    const { rewrap } = await accountPasswordRewrap(
      login.handle,
      serverShare,
      registration.handle,
      principalId,
    );
    return {
      rewrap,
      commit: async () => {
        await accountPasswordCommit(registration.handle, principalId);
      },
      discard: () => undefined,
    };
  }
  if (!(login instanceof WebLogin) || !(registration instanceof WebRegistration)) {
    throw new Error("the login and the registration come from different platforms");
  }
  if (!login.exportKey || !login.sessionKey || !registration.exportKey) {
    throw new Error("the login or the registration did not finish");
  }
  const { rewrap, newUnlockKey } = await passwordChangeRewrap({
    principalId,
    oldExportKey: login.exportKey,
    sessionKey: login.sessionKey,
    serverShare,
    newExportKey: registration.exportKey,
  });
  return {
    rewrap,
    commit: async () => {
      try {
        await commitPasswordChange(newUnlockKey);
      } finally {
        newUnlockKey.fill(0);
      }
    },
    discard: () => newUnlockKey.fill(0),
  };
}
