import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClientError } from "graphql-request";

import { PowCancelled } from "../../relay/pow/proofOfWork";

const requestMock = vi.fn();
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));

const invokeMock = vi.fn();
vi.mock("../../../core/tauri/safeInvoke", () => ({
  safeInvoke: (...args: unknown[]) => invokeMock(...args),
}));

// The desktop app: device key work goes to the Tauri side.
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => true,
}));

// The password's OPAQUE flows and the unlocks stand in for the WebAssembly module and the
// desktop's account lock: these tests check what is asked of them, in which order.
const flows = vi.hoisted(() => ({ startLogin: vi.fn(), startRegistration: vi.fn() }));
vi.mock("../../auth/runtime/opaqueFlows", () => flows);
const unlocks = vi.hoisted(() => ({
  addRecoveryWrapToUnlocked: vi.fn(),
  holdSession: vi.fn(),
  lockAccount: vi.fn(),
  unlockWithRecovery: vi.fn(),
  unlockWithRecoveryOnDesktop: vi.fn(),
}));
vi.mock("../../auth/runtime/accountUnlock", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../auth/runtime/accountUnlock")>()),
  ...unlocks,
}));

// A backend a test puts in place of the platform's, such as one that keeps no recovery kit.
const backendOverride = vi.hoisted(() => ({ value: null as KeyBackend | null }));
vi.mock("./keyBackend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./keyBackend")>();
  return { ...actual, keyBackend: () => backendOverride.value ?? actual.keyBackend() };
});

import { NeedsRecoveryError } from "../../../core/accountVault/dkWraps";
import {
  PasswordLockedError,
  PasswordWaitError,
  WrongPasswordError,
} from "../../auth/api/passwordApi";
import { useAuthStore } from "../../auth/state/useAuthStore";
import type { KeyBackend } from "./keyBackend";
import {
  abandonKeySignup,
  accountIdInKit,
  confirmRecoveryKitSaved,
  discardKeySignup,
  forgetKeysTheServerNeverSaw,
  KeyChallengeFailed,
  NoDeviceKeysError,
  profileCardIsStale,
  proofOfWorkRefused,
  profileCardRelays,
  recoverDeviceKeys,
  RegistrationClosed,
  RegistrationUnreadable,
  SignInCancelled,
  signInWithPassword,
  signupWithKey,
  unsavedRecoveryKit,
  type EnrollmentDraft,
  type MyKeyIdentity,
} from "./keyIdentity";

const ENDPOINT = "http://localhost:8080/api";
/** The origin this server is known by. */
const HERE = "http://localhost:8080";
const PRINCIPAL = "rimp1_nz1POml8JmCMcFDECrtu60ibohPKnywhcExmOPMvTUo";
const STATEMENT = { payload: "{}", signature: "sig" };

/** The operation name of a request: its document's first `query X` / `mutation X`. */
function operation(call: unknown[]): string {
  const doc = String(call[0]);
  return /(?:query|mutation)\s+(\w+)/.exec(doc)?.[1] ?? doc;
}

function serverError(code: string) {
  return new ClientError(
    { status: 200, headers: new Headers(), errors: [{ message: code, extensions: { code } }] },
    { query: "" },
  );
}

/**
 * Answer server operations and Tauri commands by name. A function answer is called with the
 * variables or args; an Error answer is thrown.
 */
function backend(server: Record<string, unknown>, desktop: Record<string, unknown> = {}) {
  const answers: Record<string, unknown> = { ...PASSWORD_ANSWERS, ...server };
  const tauri: Record<string, unknown> = { ...DESKTOP_ANSWERS, ...desktop };
  requestMock.mockImplementation(async (doc: unknown, vars: unknown) => {
    const name = operation([doc]);
    if (!(name in answers)) throw new Error(`unexpected request ${name}`);
    const answer = answers[name];
    const value = typeof answer === "function" ? answer(vars) : answer;
    if (value instanceof Error) throw value;
    return value;
  });
  invokeMock.mockImplementation(async (command: string, args: unknown) => {
    if (!(command in tauri)) return { ok: true, value: null };
    const answer = tauri[command];
    const value = typeof answer === "function" ? answer(args) : answer;
    if (value instanceof Error) {
      return {
        ok: false,
        error: { kind: "backend_error", code: "INVALID", message: value.message },
      };
    }
    return { ok: true, value };
  });
}

/** The desktop's side, unless a test says otherwise: it holds keys for {@link PRINCIPAL}. */
const DESKTOP_ANSWERS = {
  key_identity_accounts: [
    {
      principalId: PRINCIPAL,
      userId: "user-1",
      username: "ada",
      deviceId: "d",
      deviceName: "Laptop",
      hasIdentityKey: true,
      confirmed: true,
    },
  ],
};

/** The server's side of a password registration and login, unless a test says otherwise. */
const PASSWORD_ANSWERS = {
  PasswordRegistrationStart: { passwordRegistrationStart: "registration-response" },
  PasswordLoginStart: {
    passwordLoginStart: { loginId: "login-1", response: "credential-response" },
  },
  PasswordLoginFinish: {
    passwordLoginFinish: { ticket: "ticket-1", serverShare: "sealed-share", rewraps: ["rw-1"] },
  },
};

/** The password a test signs in or up with. */
const PASSWORD = { password: "correct horse battery", keep: false };

/** A started OPAQUE login whose steps the test can check. */
function fakeLogin(
  overrides: Partial<{
    finish: () => Promise<string>;
    unlock: (input: unknown) => Promise<{ startedEmpty: boolean }>;
  }> = {},
) {
  return {
    request: "credential-request",
    finish: vi.fn(overrides.finish ?? (async () => "credential-finalization")),
    unlock: vi.fn(overrides.unlock ?? (async () => ({ startedEmpty: false }))),
    close: vi.fn(),
  };
}

/** A started OPAQUE registration whose steps the test can check. */
function fakeRegistration() {
  return {
    request: "registration-request",
    finish: vi.fn(async () => "registration-upload"),
    unlockAfterSignup: vi.fn(async () => ({ startedEmpty: true })),
    close: vi.fn(),
  };
}

const CHALLENGE = { keyLoginChallenge: { challengeId: "c-1", nonce: "n-1" } };
const ME = (principalId: string | null) => ({
  me: { id: "user-1", username: "ada", displayName: "Ada", principalId },
});

function commands(): string[] {
  return invokeMock.mock.calls.map((call) => call[0] as string);
}

let login: ReturnType<typeof fakeLogin>;
let registration: ReturnType<typeof fakeRegistration>;

beforeEach(() => {
  requestMock.mockReset();
  invokeMock.mockReset();
  useAuthStore.setState({ csrfToken: null });
  backendOverride.value = null;
  login = fakeLogin();
  registration = fakeRegistration();
  flows.startLogin.mockReset();
  flows.startLogin.mockImplementation(async () => login);
  flows.startRegistration.mockReset();
  flows.startRegistration.mockImplementation(async () => registration);
  Object.values(unlocks).forEach((fn) => fn.mockReset());
  unlocks.addRecoveryWrapToUnlocked.mockResolvedValue(undefined);
  unlocks.holdSession.mockResolvedValue(undefined);
});

describe("signInWithPassword", () => {
  const signedIn = {
    KeyLoginChallenge: CHALLENGE,
    LoginWithKey: {
      loginWithKey: {
        userId: "user-1",
        csrfToken: "tok-key-login",
        sessionSecret: "secret-1",
        keepKey: null,
      },
    },
    MeKeyAccount: ME(PRINCIPAL),
  };

  it("checks the password, unlocks, then signs the device proof that carries the ticket", async () => {
    backend(signedIn, { key_identity_sign_login: STATEMENT });

    await expect(signInWithPassword(PRINCIPAL, PASSWORD)).resolves.toEqual({
      userId: "user-1",
      startedEmpty: false,
    });
    expect(flows.startLogin).toHaveBeenCalledWith(PASSWORD.password);
    expect(requestMock.mock.calls.map(operation)).toEqual([
      "PasswordLoginStart",
      "PasswordLoginFinish",
      "KeyLoginChallenge",
      "LoginWithKey",
      "MeKeyAccount",
    ]);
    expect(requestMock.mock.calls[0][1]).toEqual({
      principalId: PRINCIPAL,
      request: "credential-request",
    });
    expect(login.finish).toHaveBeenCalledWith("credential-response");
    expect(requestMock.mock.calls[1][1]).toEqual({
      loginId: "login-1",
      credentialFinalization: "credential-finalization",
    });
    expect(login.unlock).toHaveBeenCalledWith({
      endpoint: ENDPOINT,
      principalId: PRINCIPAL,
      serverShare: "sealed-share",
      rewraps: ["rw-1"],
      keep: false,
    });
    // The device key signs only once the account's keys are open.
    const signed = invokeMock.mock.calls.findIndex((c) => c[0] === "key_identity_sign_login");
    expect(login.unlock.mock.invocationCallOrder[0]).toBeLessThan(
      invokeMock.mock.invocationCallOrder[signed],
    );
    // The desktop holds its own keep key; this sign-in is not kept.
    expect(requestMock.mock.calls[3][1]).toEqual({
      proof: STATEMENT,
      passwordTicket: "ticket-1",
      keepSignedIn: false,
      keepKeyHeld: true,
    });
    // The session secret is held before the next request, which needs it.
    expect(unlocks.holdSession).toHaveBeenCalledWith({ sessionSecret: "secret-1", keepKey: null });
    expect(unlocks.holdSession.mock.invocationCallOrder[0]).toBeLessThan(
      requestMock.mock.invocationCallOrder[4],
    );
    expect(useAuthStore.getState().csrfToken).toBe("tok-key-login");
    expect(invokeMock).toHaveBeenCalledWith("key_identity_settle", {
      account: { endpoint: ENDPOINT, userId: "user-1", username: "ada" },
      principalId: PRINCIPAL,
    });
    expect(login.close).toHaveBeenCalled();
    expect(unlocks.lockAccount).not.toHaveBeenCalled();
  });

  it("refuses a sign-in for an account this device holds no keys for, before any request", async () => {
    backend(signedIn, { key_identity_accounts: [] });

    await expect(signInWithPassword(PRINCIPAL, PASSWORD)).rejects.toBeInstanceOf(NoDeviceKeysError);
    expect(requestMock).not.toHaveBeenCalled();
    expect(flows.startLogin).not.toHaveBeenCalled();
  });

  it("wraps the data key under a kept session's keep key, once the account is unlocked", async () => {
    backend(
      {
        ...signedIn,
        LoginWithKey: { loginWithKey: { userId: "user-1", keepKey: "keep-1" } },
      },
      { key_identity_sign_login: STATEMENT },
    );
    await signInWithPassword(PRINCIPAL, { ...PASSWORD, keep: true });
    const keyLogin = requestMock.mock.calls.find((c) => operation(c) === "LoginWithKey");
    expect(keyLogin?.[1]).toMatchObject({ keepSignedIn: true });
    expect(unlocks.holdSession).toHaveBeenCalledWith({
      sessionSecret: undefined,
      keepKey: "keep-1",
    });
  });

  it("passes on a revoked device's FORBIDDEN and locks the account again", async () => {
    backend(
      { KeyLoginChallenge: CHALLENGE, LoginWithKey: serverError("FORBIDDEN") },
      { key_identity_sign_login: STATEMENT },
    );
    await expect(signInWithPassword(PRINCIPAL, PASSWORD)).rejects.toBeInstanceOf(ClientError);
    expect(unlocks.lockAccount).toHaveBeenCalled();
  });

  const wrongPassword = () =>
    fakeLogin({
      finish: async () => {
        throw new WrongPasswordError();
      },
    });

  it("stops at a wrong password, signing nothing", async () => {
    login = wrongPassword();
    backend({}, { key_identity_sign_login: STATEMENT });
    await expect(signInWithPassword(PRINCIPAL, PASSWORD)).rejects.toBeInstanceOf(
      WrongPasswordError,
    );
    expect(requestMock.mock.calls.map(operation)).toEqual(["PasswordLoginStart"]);
    expect(commands()).not.toContain("key_identity_sign_login");
    expect(login.unlock).not.toHaveBeenCalled();
  });

  it("tells a locked password and a wait apart", async () => {
    backend({ PasswordLoginStart: serverError("PASSWORD_LOCKED") });
    await expect(signInWithPassword(PRINCIPAL, PASSWORD)).rejects.toBeInstanceOf(
      PasswordLockedError,
    );

    requestMock.mockReset();
    requestMock.mockRejectedValue(
      new ClientError(
        {
          status: 200,
          headers: new Headers(),
          errors: [
            { message: "wait", extensions: { code: "RATE_LIMITED", retryAfterSeconds: 290 } },
          ],
        },
        { query: "" },
      ),
    );
    const wait = await signInWithPassword(PRINCIPAL, PASSWORD).catch((err: unknown) => err);
    expect(wait).toBeInstanceOf(PasswordWaitError);
    expect((wait as Error).message).toBe("Try again in 5 minutes");
    expect(login.finish).not.toHaveBeenCalled();
  });

  it("asks for the recovery phrase, again when it does not open, or starts empty", async () => {
    let unlockCalls = 0;
    login = fakeLogin({
      unlock: async () => {
        unlockCalls += 1;
        if (unlockCalls < 3) throw new NeedsRecoveryError();
        return { startedEmpty: true };
      },
    });
    unlocks.unlockWithRecoveryOnDesktop.mockResolvedValue(false);
    backend(signedIn, { key_identity_sign_login: STATEMENT });
    const entropy = new Uint8Array(16).fill(4);
    const onNeedsRecovery = vi
      .fn()
      .mockResolvedValueOnce({ entropy })
      .mockResolvedValueOnce("startEmpty");

    await expect(
      signInWithPassword(PRINCIPAL, PASSWORD, { onNeedsRecovery }),
    ).resolves.toMatchObject({ startedEmpty: true });
    expect(onNeedsRecovery.mock.calls).toEqual([[false], [true]]);
    expect(unlocks.unlockWithRecoveryOnDesktop).toHaveBeenCalledWith(ENDPOINT, PRINCIPAL, entropy);
    expect(login.unlock.mock.calls[2][0]).toMatchObject({ startEmpty: true });
    expect(unlocks.addRecoveryWrapToUnlocked).not.toHaveBeenCalled();
  });

  it("gives up, signing nothing, when the person cancels at the recovery phrase", async () => {
    login = fakeLogin({
      unlock: async () => {
        throw new NeedsRecoveryError();
      },
    });
    backend({});
    await expect(
      signInWithPassword(PRINCIPAL, PASSWORD, { onNeedsRecovery: async () => null }),
    ).rejects.toBeInstanceOf(SignInCancelled);
    expect(requestMock.mock.calls.map(operation)).not.toContain("LoginWithKey");
  });

  it("uses a phrase the person entered already, and wraps the data key under it", async () => {
    let unlockCalls = 0;
    login = fakeLogin({
      unlock: async () => {
        unlockCalls += 1;
        if (unlockCalls === 1) throw new NeedsRecoveryError();
        return { startedEmpty: false };
      },
    });
    unlocks.unlockWithRecoveryOnDesktop.mockResolvedValue(true);
    backend(signedIn, { key_identity_sign_login: STATEMENT });
    const entropy = new Uint8Array(16).fill(5);
    const onNeedsRecovery = vi.fn();

    await signInWithPassword(PRINCIPAL, PASSWORD, { recoveryEntropy: entropy, onNeedsRecovery });
    expect(onNeedsRecovery).not.toHaveBeenCalled();
    expect(unlocks.unlockWithRecoveryOnDesktop).toHaveBeenCalledWith(ENDPOINT, PRINCIPAL, entropy);
    expect(unlocks.addRecoveryWrapToUnlocked).toHaveBeenCalledWith(entropy);
  });
});

describe("signupWithKey", () => {
  // Each test its own draft: the module remembers what each draft was last sent with.
  let n = 0;
  let draft: EnrollmentDraft;
  beforeEach(() => {
    n += 1;
    draft = {
      draftId: `draft-${n}`,
      principalId: PRINCIPAL,
      inceptionPayload: "{}",
      recoveryKit: "kit",
      recoveryPhrase: [],
    };
  });
  const statements = { keyLog: [STATEMENT], device: STATEMENT, proof: STATEMENT };
  const identity = {
    myKeyIdentity: {
      principalId: PRINCIPAL,
      keySeq: 0,
      keyLog: [{ seq: 0, statement: STATEMENT }],
      devices: [],
      profileCard: null,
    },
  };
  const fields = { username: " ada ", displayName: "Ada", workspaceInviteToken: "ws-tok" };
  const created = {
    signupWithKey: {
      userId: "user-1",
      serverId: "srv-1",
      csrfToken: "tok-key",
      serverShare: "share-1",
    },
  };
  const LOG = { keyLog: [{ seq: 0, statement: STATEMENT }] };

  it("stores and signs the draft's keys, creates the account, keeps its csrfToken, settles and publishes the card", async () => {
    backend(
      {
        KeyLoginChallenge: CHALLENGE,
        SignupWithKey: created,
        MyKeyIdentity: identity,
        PublishProfileCard: { publishProfileCard: { version: 1 } },
      },
      { key_identity_sign_signup: statements, key_identity_sign_profile_card: STATEMENT },
    );

    await expect(signupWithKey(draft, fields, PASSWORD)).resolves.toEqual({
      userId: "user-1",
      serverId: "srv-1",
    });
    expect(useAuthStore.getState().csrfToken).toBe("tok-key");
    expect(invokeMock).toHaveBeenCalledWith("key_identity_sign_signup", {
      draftId: draft.draftId,
      endpoint: ENDPOINT,
      username: "ada",
      challenge: { challengeId: "c-1", nonce: "n-1" },
    });
    const signup = requestMock.mock.calls.find((c) => operation(c) === "SignupWithKey");
    expect(signup?.[1]).toEqual({
      input: {
        username: "ada",
        displayName: "Ada",
        workspaceInviteToken: "ws-tok",
        keyLog: [STATEMENT],
        device: STATEMENT,
        proof: STATEMENT,
        passwordRegistration: "registration-upload",
        keepSignedIn: false,
        keepKeyHeld: true,
      },
    });
    expect(unlocks.holdSession).toHaveBeenCalledWith({ sessionSecret: null, keepKey: null });
    // The password is registered first, and the new account unlocked once the server took it.
    expect(flows.startRegistration).toHaveBeenCalledWith(PASSWORD.password);
    expect(requestMock.mock.calls[0]).toEqual([
      expect.stringContaining("PasswordRegistrationStart"),
      { principalId: PRINCIPAL, request: "registration-request" },
    ]);
    expect(registration.finish).toHaveBeenCalledWith("registration-response");
    expect(registration.unlockAfterSignup).toHaveBeenCalledWith({
      endpoint: ENDPOINT,
      principalId: PRINCIPAL,
      serverShare: "share-1",
      recoveryEntropy: null,
      keep: false,
    });
    expect(registration.close).toHaveBeenCalled();
    expect(invokeMock).toHaveBeenCalledWith("key_identity_settle", {
      account: { endpoint: ENDPOINT, userId: "user-1", username: "ada" },
      principalId: PRINCIPAL,
    });
    expect(commands()).toEqual([
      "key_identity_confirm_recovery_kit",
      "key_identity_sign_signup",
      "key_identity_settle",
      "key_identity_sign_profile_card",
    ]);
    const card = invokeMock.mock.calls.find((c) => c[0] === "key_identity_sign_profile_card");
    expect(card?.[1]).toMatchObject({ card: { version: 1, displayName: "Ada" } });
  });

  it("still succeeds when finishing up fails: the account exists and the session is set", async () => {
    backend(
      {
        KeyLoginChallenge: CHALLENGE,
        SignupWithKey: created,
        MyKeyIdentity: new TypeError("Failed to fetch"),
      },
      { key_identity_sign_signup: statements, key_identity_settle: new Error("keyring locked") },
    );
    await expect(signupWithKey(draft, fields, PASSWORD)).resolves.toEqual({
      userId: "user-1",
      serverId: "srv-1",
    });
  });

  it("marks a failed challenge, before anything is signed or sent", async () => {
    backend({ KeyLoginChallenge: serverError("RATE_LIMITED") });
    const failure = await signupWithKey(draft, fields, PASSWORD).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(KeyChallengeFailed);
    expect((failure as KeyChallengeFailed).reason).toBeInstanceOf(ClientError);
    expect(commands()).toEqual(["key_identity_confirm_recovery_kit"]);
  });

  it("leaves a kit saved later unconfirmed", async () => {
    backend({ KeyLoginChallenge: serverError("RATE_LIMITED") });
    const failure = await signupWithKey(draft, fields, PASSWORD, { recoveryKit: "later" }).catch(
      (err: unknown) => err,
    );
    expect(failure).toBeInstanceOf(KeyChallengeFailed);
    expect(commands()).toEqual([]);
  });

  it("removes the keys but keeps the draft when the server refused the signup", async () => {
    backend(
      {
        KeyLoginChallenge: CHALLENGE,
        SignupWithKey: serverError("CONFLICT"),
        KeyLog: { keyLog: [] },
      },
      { key_identity_sign_signup: statements },
    );
    await expect(signupWithKey(draft, fields, PASSWORD)).rejects.toBeInstanceOf(ClientError);
    expect(commands()).toEqual([
      "key_identity_confirm_recovery_kit",
      "key_identity_sign_signup",
      "key_identity_remove_draft_keys",
    ]);
    expect(invokeMock).toHaveBeenCalledWith("key_identity_remove_draft_keys", {
      draftId: draft.draftId,
    });
  });

  it("finishes like a success when an earlier attempt whose answer was lost created the account", async () => {
    backend(
      {
        KeyLoginChallenge: CHALLENGE,
        SignupWithKey: serverError("CONFLICT"),
        KeyLog: LOG,
        LoginWithKey: { loginWithKey: { userId: "user-1" } },
        MeKeyAccount: ME(PRINCIPAL),
        MyKeyIdentity: identity,
        PublishProfileCard: { publishProfileCard: { version: 1 } },
      },
      {
        key_identity_sign_signup: statements,
        key_identity_sign_login: STATEMENT,
        key_identity_sign_profile_card: STATEMENT,
      },
    );
    // The server id is not known here: the caller has the invite's preview.
    await expect(signupWithKey(draft, fields, PASSWORD)).resolves.toEqual({
      userId: "user-1",
      serverId: null,
    });
    expect(commands()).toEqual([
      "key_identity_confirm_recovery_kit",
      "key_identity_sign_signup",
      "key_identity_restore_draft_keys",
      "key_identity_accounts",
      "key_identity_sign_login",
      "key_identity_settle",
      "key_identity_sign_profile_card",
    ]);
    expect(invokeMock).toHaveBeenCalledWith("key_identity_restore_draft_keys", {
      draftId: draft.draftId,
      endpoint: ENDPOINT,
      username: "ada",
    });
  });

  it("keeps the keys and passes on the error when signing in to that account fails", async () => {
    const refused = serverError("UNAUTHENTICATED");
    backend(
      {
        KeyLoginChallenge: CHALLENGE,
        SignupWithKey: serverError("CONFLICT"),
        KeyLog: LOG,
        LoginWithKey: refused,
      },
      { key_identity_sign_signup: statements, key_identity_sign_login: STATEMENT },
    );
    await expect(signupWithKey(draft, fields, PASSWORD)).rejects.toBe(refused);
    expect(commands()).not.toContain("key_identity_remove_draft_keys");
    expect(commands()).not.toContain("key_identity_discard_enrollment");
    expect(commands()).not.toContain("key_identity_forget_unconfirmed");
  });

  it("keeps the keys when the server cannot say whether the account exists", async () => {
    backend(
      {
        KeyLoginChallenge: CHALLENGE,
        SignupWithKey: new TypeError("Failed to fetch"),
        KeyLog: new TypeError("Failed to fetch"),
      },
      { key_identity_sign_signup: statements },
    );
    await expect(signupWithKey(draft, fields, PASSWORD)).rejects.toBeInstanceOf(TypeError);
    expect(commands()).toEqual(["key_identity_confirm_recovery_kit", "key_identity_sign_signup"]);
  });

  it("discarding after a failure the server committed after all gives the keys back and signs in", async () => {
    // The attempt failed and the log was still empty, so its keys went.
    backend(
      {
        KeyLoginChallenge: CHALLENGE,
        SignupWithKey: new TypeError("Failed to fetch"),
        KeyLog: { keyLog: [] },
      },
      { key_identity_sign_signup: statements },
    );
    await expect(signupWithKey(draft, fields, PASSWORD)).rejects.toBeInstanceOf(TypeError);
    expect(commands()).toContain("key_identity_remove_draft_keys");

    // The server committed it later: discarding finds the account and opens it.
    invokeMock.mockClear();
    backend(
      {
        KeyLog: LOG,
        KeyLoginChallenge: CHALLENGE,
        LoginWithKey: { loginWithKey: { userId: "user-1" } },
        MeKeyAccount: ME(PRINCIPAL),
        MyKeyIdentity: new TypeError("Failed to fetch"),
      },
      { key_identity_sign_login: STATEMENT },
    );
    await expect(discardKeySignup(draft, PASSWORD)).resolves.toEqual({
      userId: "user-1",
      serverId: null,
    });
    expect(commands()).toEqual([
      "key_identity_restore_draft_keys",
      "key_identity_accounts",
      "key_identity_sign_login",
      "key_identity_settle",
    ]);
  });

  it("discarding removes the keys only when no account here holds them", async () => {
    backend({ KeyLog: { keyLog: [] } });
    await expect(discardKeySignup(draft, PASSWORD)).resolves.toBeNull();
    expect(commands()).toEqual(["key_identity_discard_enrollment"]);

    invokeMock.mockClear();
    backend({ KeyLog: new TypeError("Failed to fetch") });
    await expect(discardKeySignup(draft, PASSWORD)).resolves.toBeNull();
    expect(commands()).toEqual([]);
  });

  it("leaving the page removes unaccepted keys and gives an accepted account its keys back", async () => {
    backend({ KeyLog: { keyLog: [] } });
    await abandonKeySignup(draft);
    expect(commands()).toEqual(["key_identity_discard_enrollment"]);

    // A draft sent and refused, then committed by the server after all.
    invokeMock.mockClear();
    backend(
      {
        KeyLoginChallenge: CHALLENGE,
        SignupWithKey: serverError("CONFLICT"),
        KeyLog: { keyLog: [] },
      },
      { key_identity_sign_signup: statements },
    );
    await expect(signupWithKey(draft, fields, PASSWORD)).rejects.toBeInstanceOf(ClientError);
    invokeMock.mockClear();
    backend({ KeyLog: LOG });
    await abandonKeySignup(draft);
    expect(commands()).toEqual(["key_identity_restore_draft_keys"]);

    invokeMock.mockClear();
    backend({ KeyLog: new TypeError("Failed to fetch") });
    await abandonKeySignup(draft);
    expect(commands()).toEqual([]);
  });

  it("abandons nothing while a signup is still in flight", async () => {
    let answer: (value: unknown) => void = () => undefined;
    backend(
      {
        KeyLoginChallenge: CHALLENGE,
        SignupWithKey: () => new Promise((resolve) => (answer = resolve)),
        KeyLog: { keyLog: [] },
        MyKeyIdentity: new TypeError("Failed to fetch"),
      },
      { key_identity_sign_signup: statements },
    );
    const signingUp = signupWithKey(draft, fields, PASSWORD);
    await vi.waitFor(() =>
      expect(requestMock.mock.calls.some((c) => operation(c) === "SignupWithKey")).toBe(true),
    );

    await abandonKeySignup(draft);
    await expect(discardKeySignup(draft, PASSWORD)).resolves.toBeNull();
    expect(
      await forgetKeysTheServerNeverSaw({ ...LOCAL_UNCONFIRMED, principalId: PRINCIPAL }),
    ).toBe(false);
    expect(commands()).toEqual(["key_identity_confirm_recovery_kit", "key_identity_sign_signup"]);

    answer(created);
    await signingUp;
    expect(commands()).toContain("key_identity_settle");
    expect(commands()).not.toContain("key_identity_discard_enrollment");
  });
});

const LOCAL_UNCONFIRMED = {
  principalId: PRINCIPAL,
  userId: null,
  username: "ada",
  deviceId: "d-1",
  deviceName: "Laptop",
  hasIdentityKey: true,
  confirmed: false,
};

describe("signupWithKey on a relay in pow registration mode", () => {
  let n = 0;
  let draft: EnrollmentDraft;
  beforeEach(() => {
    n += 1;
    draft = {
      draftId: `pow-draft-${n}`,
      principalId: PRINCIPAL,
      inceptionPayload: '{"v":2,"type":"inception","seq":0}',
      recoveryKit: "kit",
      recoveryPhrase: [],
    };
  });
  const statements = { keyLog: [STATEMENT], device: STATEMENT, proof: STATEMENT };
  const created = { signupWithKey: { userId: "user-1", serverId: null } };
  const identity = {
    myKeyIdentity: {
      principalId: PRINCIPAL,
      keySeq: 0,
      keyLog: [{ seq: 0, statement: STATEMENT }],
      devices: [],
      profileCard: null,
    },
  };
  const NONCE = "AAAAAAAAkaM";

  /** This server's verified discovery document, as the Tauri side answers it. */
  function discovery(registration: { mode: string; powBits: number | null }) {
    return {
      log: [],
      head: { serverId: "rims1_relay" },
      descriptor: { serverId: "rims1_relay", registration },
    };
  }

  const server = (signup: unknown = created) => ({
    KeyLoginChallenge: CHALLENGE,
    SignupWithKey: signup,
    KeyLog: { keyLog: [] },
    MyKeyIdentity: identity,
    PublishProfileCard: { publishProfileCard: { version: 1 } },
  });

  function sentInput(call = 0): Record<string, unknown> | undefined {
    const signups = requestMock.mock.calls.filter((c) => operation(c) === "SignupWithKey");
    return (signups[call]?.[1] as { input: Record<string, unknown> } | undefined)?.input;
  }

  it("finds the proof over the draft's inception before the challenge, and sends it", async () => {
    backend(server(), {
      relay_direct_discovery: "document",
      relay_verify_discovery: discovery({ mode: "pow", powBits: 20 }),
      relay_solve_pow: NONCE,
      key_identity_sign_signup: statements,
      key_identity_sign_profile_card: STATEMENT,
    });
    const onProofOfWork = vi.fn();

    await expect(
      signupWithKey(draft, { username: "ada" }, PASSWORD, { onProofOfWork }),
    ).resolves.toEqual({
      userId: "user-1",
      serverId: null,
    });

    expect(onProofOfWork).toHaveBeenCalledWith(20);
    expect(invokeMock).toHaveBeenCalledWith("relay_direct_discovery", {
      origin: "http://localhost:8080",
    });
    expect(invokeMock).toHaveBeenCalledWith("relay_verify_discovery", {
      document: "document",
      origin: "http://localhost:8080",
    });
    expect(invokeMock).toHaveBeenCalledWith("relay_solve_pow", {
      jobId: expect.any(String),
      serverId: "rims1_relay",
      inceptionPayload: draft.inceptionPayload,
      bits: 20,
    });
    expect(commands().slice(0, 5)).toEqual([
      "key_identity_confirm_recovery_kit",
      "relay_direct_discovery",
      "relay_verify_discovery",
      "relay_solve_pow",
      "key_identity_sign_signup",
    ]);
    // The proof is found before the password is registered and the challenge is asked for,
    // so neither can expire meanwhile.
    expect(requestMock.mock.calls.map(operation).slice(0, 2)).toEqual([
      "PasswordRegistrationStart",
      "KeyLoginChallenge",
    ]);
    expect(invokeMock.mock.invocationCallOrder[3]).toBeLessThan(
      requestMock.mock.invocationCallOrder[0],
    );
    expect(sentInput()).toMatchObject({ username: "ada", proofOfWork: NONCE });
  });

  it("sends nothing and searches no proof when the discovery document says the server is full", async () => {
    backend(server(), {
      relay_direct_discovery: JSON.stringify({ registration: { full: true } }),
      relay_verify_discovery: discovery({ mode: "pow", powBits: 20 }),
      relay_solve_pow: NONCE,
      key_identity_sign_signup: statements,
    });
    const onProofOfWork = vi.fn();

    await expect(
      signupWithKey(draft, { username: "ada" }, PASSWORD, { onProofOfWork }),
    ).rejects.toThrow(RegistrationClosed);

    expect(onProofOfWork).not.toHaveBeenCalled();
    expect(commands()).not.toContain("relay_solve_pow");
    expect(sentInput()).toBeUndefined();
  });

  it.each([
    ["an instance invite", { instanceInviteToken: "inst-tok" }],
    ["a workspace invite", { workspaceInviteToken: "ws-tok" }],
  ])("skips the proof with %s", async (_case, token) => {
    backend(server(), {
      key_identity_sign_signup: statements,
      key_identity_sign_profile_card: STATEMENT,
    });
    await signupWithKey(draft, { username: "ada", ...token }, PASSWORD);
    expect(commands().filter((c) => c.startsWith("relay_"))).toEqual([]);
    expect(sentInput()).toEqual(expect.objectContaining(token));
    expect(sentInput()).not.toHaveProperty("proofOfWork");
  });

  it.each([
    ["in open mode", {}, discovery({ mode: "open", powBits: null })],
    [
      "when the discovery document cannot be read and the server says it is open",
      { RegistrationMode: { registrationMode: "OPEN" } },
      new Error("server discovery: malformed"),
    ],
    [
      "when the discovery document cannot be read and the server says it is invite-only",
      { RegistrationMode: { registrationMode: "INVITE_ONLY" } },
      new Error("server discovery: malformed"),
    ],
  ])("sends no proof %s", async (_case, mode, verified) => {
    backend(
      { ...server(), ...mode },
      {
        relay_direct_discovery: "document",
        relay_verify_discovery: verified,
        key_identity_sign_signup: statements,
        key_identity_sign_profile_card: STATEMENT,
      },
    );
    await signupWithKey(draft, { username: "ada" }, PASSWORD);
    expect(commands()).not.toContain("relay_solve_pow");
    expect(sentInput()).not.toHaveProperty("proofOfWork");
  });

  it.each([
    ["asks for a proof-of-work", { RegistrationMode: { registrationMode: "POW" } }],
    ["cannot say how it takes accounts", {}],
  ])(
    "sends nothing when the discovery document cannot be read and the server %s",
    async (_case, mode) => {
      backend(
        { ...server(), ...mode },
        {
          relay_direct_discovery: "document",
          relay_verify_discovery: new Error("server discovery: malformed"),
          key_identity_sign_signup: statements,
        },
      );
      await expect(signupWithKey(draft, { username: "ada" }, PASSWORD)).rejects.toBeInstanceOf(
        RegistrationUnreadable,
      );
      expect(commands()).not.toContain("key_identity_sign_signup");
      expect(sentInput()).toBeUndefined();
    },
  );

  it("reuses the nonce on a retry, and searches again after the server refused it", async () => {
    let solved = 0;
    const tauri = {
      relay_direct_discovery: "document",
      relay_verify_discovery: discovery({ mode: "pow", powBits: 20 }),
      relay_solve_pow: () => `nonce-${++solved}`,
      key_identity_sign_signup: statements,
      key_identity_sign_profile_card: STATEMENT,
    };
    backend(server(serverError("CONFLICT")), tauri);
    await expect(signupWithKey(draft, { username: "ada" }, PASSWORD)).rejects.toBeInstanceOf(
      ClientError,
    );
    expect(sentInput(0)).toMatchObject({ proofOfWork: "nonce-1" });

    const refused = serverError("VALIDATION");
    refused.response.errors![0].message =
      "proofOfWork does not have the required leading zero bits";
    backend(server(refused), tauri);
    await expect(signupWithKey(draft, { username: "ada2" }, PASSWORD)).rejects.toBeInstanceOf(
      ClientError,
    );
    expect(sentInput(1)).toMatchObject({ proofOfWork: "nonce-1" });
    expect(solved).toBe(1);

    backend(server(), tauri);
    await signupWithKey(draft, { username: "ada2" }, PASSWORD);
    expect(sentInput(2)).toMatchObject({ proofOfWork: "nonce-2" });
    expect(solved).toBe(2);
  });

  it("stops when the search is cancelled, before anything is signed or sent", async () => {
    backend(server(), {
      relay_direct_discovery: "document",
      relay_verify_discovery: discovery({ mode: "pow", powBits: 20 }),
      relay_solve_pow: null,
    });
    const stop = new AbortController();
    const signup = signupWithKey(draft, { username: "ada" }, PASSWORD, { signal: stop.signal });
    stop.abort();
    await expect(signup).rejects.toBeInstanceOf(PowCancelled);
    expect(commands()).not.toContain("key_identity_sign_signup");
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("tells a refusal over the proof-of-work from other refusals", () => {
    const refusal = (code: string, message: string) => {
      const err = serverError(code);
      err.response.errors![0].message = message;
      return err;
    };
    expect(
      proofOfWorkRefused(refusal("VALIDATION", "a registration token or proofOfWork is required")),
    ).toBe(true);
    expect(proofOfWorkRefused(refusal("FORBIDDEN", "proof-of-work refused"))).toBe(true);
    expect(proofOfWorkRefused(refusal("VALIDATION", "username must be 3 to 32 characters"))).toBe(
      false,
    );
    expect(proofOfWorkRefused(refusal("CONFLICT", "proofOfWork"))).toBe(false);
  });
});

describe("forgetKeysTheServerNeverSaw", () => {
  it("removes unconfirmed keys whose principal the server has no log for", async () => {
    backend({ KeyLog: { keyLog: [] } });
    await expect(forgetKeysTheServerNeverSaw(LOCAL_UNCONFIRMED)).resolves.toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("key_identity_forget_unconfirmed", {
      principalId: PRINCIPAL,
    });
  });

  it("keeps keys the server knows, confirmed keys, and keys when it cannot say", async () => {
    backend({ KeyLog: { keyLog: [{ seq: 0, statement: STATEMENT }] } });
    await expect(forgetKeysTheServerNeverSaw(LOCAL_UNCONFIRMED)).resolves.toBe(false);
    backend({ KeyLog: new TypeError("Failed to fetch") });
    await expect(forgetKeysTheServerNeverSaw(LOCAL_UNCONFIRMED)).resolves.toBe(false);
    backend({ KeyLog: { keyLog: [] } });
    await expect(
      forgetKeysTheServerNeverSaw({ ...LOCAL_UNCONFIRMED, confirmed: true }),
    ).resolves.toBe(false);
    expect(commands()).toEqual([]);
  });
});

describe("recoverDeviceKeys", () => {
  const ENTRY = { payload: '{"type":"rotate","seq":1}', signature: "ed25519:r" };
  const recovery = { principalId: PRINCIPAL, deviceId: "d-new", entry: ENTRY, device: STATEMENT };
  const before = { keyLog: [{ seq: 0, statement: STATEMENT }] };
  const after = {
    keyLog: [
      { seq: 0, statement: STATEMENT },
      { seq: 1, statement: ENTRY },
    ],
  };
  const kit = `RIM recovery kit (v1)\nAccount id: ${PRINCIPAL}\nRecovery key: RK1-AAAA`;

  it("reads the public log and rotates with the recovery key, leaving the sign-in to the password", async () => {
    backend(
      {
        KeyLog: { keyLog: [{ seq: 0, statement: STATEMENT }] },
        RotateIdentityKey: { rotateIdentityKey: { principalId: PRINCIPAL, keySeq: 1 } },
      },
      { key_identity_begin_recovery: recovery },
    );

    await expect(recoverDeviceKeys(kit, null, "New laptop")).resolves.toBe(PRINCIPAL);
    expect(requestMock.mock.calls.map(operation)).not.toContain("LoginWithKey");
    expect(requestMock.mock.calls.find((c) => operation(c) === "KeyLog")?.[1]).toEqual({
      principalId: PRINCIPAL,
    });
    expect(invokeMock).toHaveBeenCalledWith("key_identity_begin_recovery", {
      endpoint: ENDPOINT,
      kit,
      accountId: PRINCIPAL,
      keyLog: [STATEMENT],
      deviceName: "New laptop",
    });
    const rotate = requestMock.mock.calls.find((c) => operation(c) === "RotateIdentityKey");
    expect(rotate?.[1]).toEqual({ input: { entry: ENTRY, device: STATEMENT } });
  });

  it("undoes the attempt when the log shows the server refused it", async () => {
    backend(
      { KeyLog: before, RotateIdentityKey: serverError("VALIDATION") },
      { key_identity_begin_recovery: recovery },
    );
    await expect(recoverDeviceKeys(kit, null, "New")).rejects.toBeInstanceOf(ClientError);
    expect(invokeMock).toHaveBeenCalledWith("key_identity_discard_recovery", {
      principalId: PRINCIPAL,
      deviceId: "d-new",
    });
    expect(commands()).not.toContain("key_identity_forget");
  });

  it("goes on when the rotation landed although its answer was an error", async () => {
    let logReads = 0;
    backend(
      {
        KeyLog: () => (logReads++ === 0 ? before : after),
        RotateIdentityKey: serverError("INTERNAL"),
      },
      { key_identity_begin_recovery: recovery },
    );
    await expect(recoverDeviceKeys(kit, null, "New")).resolves.toBe(PRINCIPAL);
    expect(commands()).not.toContain("key_identity_discard_recovery");
  });

  it("keeps the keys when the server cannot say what happened", async () => {
    let logReads = 0;
    backend(
      {
        KeyLog: () => (logReads++ === 0 ? before : new TypeError("Failed to fetch")),
        RotateIdentityKey: new TypeError("Failed to fetch"),
      },
      { key_identity_begin_recovery: recovery },
    );
    await expect(recoverDeviceKeys(kit, null, "New")).rejects.toBeInstanceOf(TypeError);
    expect(commands()).not.toContain("key_identity_discard_recovery");
    expect(commands()).not.toContain("key_identity_forget");
  });

  it("needs an account id and passes on a bad kit", async () => {
    await expect(recoverDeviceKeys("RK1-AAAA", null, "New")).rejects.toThrow(/account id/);
    backend(
      { KeyLog: { keyLog: [] } },
      { key_identity_begin_recovery: new Error("this recovery key has a typo") },
    );
    await expect(recoverDeviceKeys("RK1-AAAA", PRINCIPAL, "New")).rejects.toThrow(/typo/);
  });
});

describe("the recovery kit", () => {
  const kit = {
    principalId: PRINCIPAL,
    recoveryKit: `RIM recovery kit (v2)\nAccount id: ${PRINCIPAL}\nRecovery phrase: abandon\n`,
    recoveryPhrase: ["abandon"],
  };

  it("reads an unsaved kit from the vault, and nothing once it is saved", async () => {
    backend({}, { key_identity_recovery_kit: kit });
    await expect(unsavedRecoveryKit(PRINCIPAL)).resolves.toEqual(kit);
    expect(invokeMock).toHaveBeenCalledWith("key_identity_recovery_kit", {
      principalId: PRINCIPAL,
    });

    backend({}, { key_identity_recovery_kit: null });
    await expect(unsavedRecoveryKit(PRINCIPAL)).resolves.toBeNull();
  });

  it("confirms a saved kit, and fails visibly when the vault cannot be reached", async () => {
    backend({});
    await confirmRecoveryKitSaved(PRINCIPAL);
    expect(invokeMock).toHaveBeenCalledWith("key_identity_confirm_recovery_kit", {
      principalId: PRINCIPAL,
    });

    const locked = new Error("key storage: the vault is locked");
    backend({}, { key_identity_confirm_recovery_kit: locked, key_identity_recovery_kit: locked });
    await expect(confirmRecoveryKitSaved(PRINCIPAL)).rejects.toThrow(locked.message);
    await expect(unsavedRecoveryKit(PRINCIPAL)).rejects.toThrow(locked.message);
  });
});

describe("helpers", () => {
  it("finds the account id in a pasted kit", () => {
    expect(accountIdInKit(`Account id: ${PRINCIPAL}\n`)).toBe(PRINCIPAL);
    expect(accountIdInKit("RK1-AAAA")).toBeNull();
  });

  function identity(card: object | null, devices: MyKeyIdentity["devices"] = []): MyKeyIdentity {
    return {
      principalId: PRINCIPAL,
      keySeq: 0,
      keyLog: [],
      devices,
      profileCard: card
        ? {
            version: 1,
            updatedAt: "2026-10-09T00:00:00Z",
            statement: { payload: JSON.stringify(card), signature: "s" },
          }
        : null,
    };
  }

  it("says when the profile card no longer matches", () => {
    const device = {
      deviceId: "d-1",
      publicKey: "k",
      name: "Laptop",
      keySeq: 0,
      certificate: STATEMENT,
      addedAt: "2026-10-09T00:00:00Z",
      lastUsedAt: null,
      revokedAt: null,
    };
    const card = {
      displayName: "Ada",
      keySeq: 0,
      relays: ["http://localhost:8080"],
      devices: [{ deviceId: "d-1" }],
    };
    expect(profileCardIsStale(identity(card, [device]), "Ada", HERE)).toBe(false);
    expect(profileCardIsStale(identity(null, [device]), "Ada", HERE)).toBe(true);
    expect(profileCardIsStale(identity(card, [device]), "Ada L.", HERE)).toBe(true);
    expect(profileCardIsStale(identity({ ...card, keySeq: 1 }, [device]), "Ada", HERE)).toBe(true);
    expect(
      profileCardIsStale(
        identity(card, [{ ...device, revokedAt: "2026-10-09T01:00:00Z" }]),
        "Ada",
        HERE,
      ),
    ).toBe(true);
  });

  it("keeps the relays the person chose, as long as this server is one of them", () => {
    const device = {
      deviceId: "d-1",
      publicKey: "k",
      name: "Laptop",
      keySeq: 0,
      certificate: STATEMENT,
      addedAt: "2026-10-09T00:00:00Z",
      lastUsedAt: null,
      revokedAt: null,
    };
    const card = (relays: string[]) => ({
      displayName: "Ada",
      keySeq: 0,
      relays,
      devices: [{ deviceId: "d-1" }],
    });
    const chosen = identity(card(["https://relay.example", "http://localhost:8080"]), [device]);
    expect(profileCardRelays(HERE, chosen)).toEqual([
      "https://relay.example",
      "http://localhost:8080",
    ]);
    expect(profileCardIsStale(chosen, "Ada", HERE)).toBe(false);
    const elsewhere = identity(card(["https://relay.example"]), [device]);
    expect(profileCardRelays(HERE, elsewhere)).toEqual([
      "http://localhost:8080",
      "https://relay.example",
    ]);
    expect(profileCardIsStale(elsewhere, "Ada", HERE)).toBe(true);
    expect(profileCardRelays(HERE, identity(null, [device]))).toEqual(["http://localhost:8080"]);
  });
});
