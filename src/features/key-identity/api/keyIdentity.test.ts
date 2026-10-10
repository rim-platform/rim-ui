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

import {
  abandonEnrollment,
  abandonKeySignup,
  accountIdInKit,
  completeEnrollment,
  discardKeySignup,
  forgetKeysTheServerNeverSaw,
  KeyChallengeFailed,
  profileCardIsStale,
  proofOfWorkRefused,
  profileCardRelays,
  reconcileDeviceKeys,
  recoverAccount,
  resumeWithDeviceKey,
  signInWithDeviceKey,
  signupWithKey,
  type EnrollmentDraft,
  type MyKeyIdentity,
} from "./keyIdentity";

const ENDPOINT = "http://localhost:8080/api";
const PRINCIPAL = "rimp1_nz1POml8JmCMcFDECrtu60ibohPKnywhcExmOPMvTUo";
const STATEMENT = { payload: "{}", signature: "sig" };
const ACCOUNT = { userId: "user-1", username: "ada", displayName: "Ada" };

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
function backend(server: Record<string, unknown>, tauri: Record<string, unknown> = {}) {
  requestMock.mockImplementation(async (doc: unknown, vars: unknown) => {
    const name = operation([doc]);
    if (!(name in server)) throw new Error(`unexpected request ${name}`);
    const answer = server[name];
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

const CHALLENGE = { keyLoginChallenge: { challengeId: "c-1", nonce: "n-1" } };
const ME = (principalId: string | null) => ({
  me: { id: "user-1", username: "ada", displayName: "Ada", principalId },
});

function commands(): string[] {
  return invokeMock.mock.calls.map((call) => call[0] as string);
}

beforeEach(() => {
  requestMock.mockReset();
  invokeMock.mockReset();
});

describe("signInWithDeviceKey", () => {
  it("signs a fresh challenge on the Tauri side and links the keys to the account", async () => {
    backend(
      {
        KeyLoginChallenge: CHALLENGE,
        LoginWithKey: { loginWithKey: { userId: "user-1" } },
        MeKeyAccount: ME(PRINCIPAL),
      },
      { key_identity_sign_login: STATEMENT },
    );

    await expect(signInWithDeviceKey(PRINCIPAL)).resolves.toBe("user-1");
    expect(invokeMock).toHaveBeenCalledWith("key_identity_sign_login", {
      endpoint: ENDPOINT,
      principalId: PRINCIPAL,
      challenge: { challengeId: "c-1", nonce: "n-1" },
    });
    const login = requestMock.mock.calls.find((c) => operation(c) === "LoginWithKey");
    expect(login?.[1]).toEqual({ proof: STATEMENT });
    expect(invokeMock).toHaveBeenCalledWith("key_identity_settle", {
      account: { endpoint: ENDPOINT, userId: "user-1", username: "ada" },
      principalId: PRINCIPAL,
    });
  });

  it("passes on a revoked device's FORBIDDEN", async () => {
    backend(
      { KeyLoginChallenge: CHALLENGE, LoginWithKey: serverError("FORBIDDEN") },
      { key_identity_sign_login: STATEMENT },
    );
    await expect(signInWithDeviceKey(PRINCIPAL)).rejects.toBeInstanceOf(ClientError);
  });
});

describe("resumeWithDeviceKey", () => {
  const local = {
    principalId: PRINCIPAL,
    userId: "user-1",
    username: "ada",
    deviceId: "d-1",
    deviceName: "Laptop",
    hasIdentityKey: true,
    confirmed: true,
  };

  it("signs in again with the key of the recorded account", async () => {
    backend(
      {
        KeyLoginChallenge: CHALLENGE,
        LoginWithKey: { loginWithKey: { userId: "user-1" } },
        MeKeyAccount: ME(PRINCIPAL),
      },
      { key_identity_accounts: [local], key_identity_sign_login: STATEMENT },
    );
    await expect(resumeWithDeviceKey("user-1")).resolves.toBe("user-1");
  });

  it("gives up without a key for that account, or when the sign-in fails", async () => {
    backend({}, { key_identity_accounts: [local] });
    await expect(resumeWithDeviceKey("user-2")).resolves.toBeNull();
    expect(requestMock).not.toHaveBeenCalled();

    backend(
      { KeyLoginChallenge: CHALLENGE, LoginWithKey: serverError("FORBIDDEN") },
      { key_identity_accounts: [local], key_identity_sign_login: STATEMENT },
    );
    await expect(resumeWithDeviceKey("user-1")).resolves.toBeNull();
  });

  it("is a no-op in the web app", async () => {
    invokeMock.mockResolvedValue({
      ok: false,
      error: { kind: "ipc_unavailable", message: "no tauri" },
    });
    await expect(resumeWithDeviceKey("user-1")).resolves.toBeNull();
  });
});

describe("enrollment", () => {
  const draft: EnrollmentDraft = {
    draftId: "draft-1",
    principalId: PRINCIPAL,
    recoveryKit: "kit",
    recoveryPhrase: [],
  };
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

  it("signs over a challenge, enrolls, settles and publishes the profile card", async () => {
    backend(
      {
        KeyLoginChallenge: CHALLENGE,
        EnrollIdentityKey: { enrollIdentityKey: { principalId: PRINCIPAL } },
        MyKeyIdentity: identity,
        PublishProfileCard: { publishProfileCard: { version: 1 } },
      },
      { key_identity_sign_enrollment: statements, key_identity_sign_profile_card: STATEMENT },
    );

    await completeEnrollment(draft, ACCOUNT);
    expect(invokeMock).toHaveBeenCalledWith("key_identity_sign_enrollment", {
      draftId: "draft-1",
      account: { endpoint: ENDPOINT, userId: "user-1", username: "ada" },
      challenge: { challengeId: "c-1", nonce: "n-1" },
    });
    const enroll = requestMock.mock.calls.find((c) => operation(c) === "EnrollIdentityKey");
    expect(enroll?.[1]).toEqual({ input: statements });
    expect(commands()).toEqual([
      "key_identity_sign_enrollment",
      "key_identity_settle",
      "key_identity_sign_profile_card",
    ]);
    const card = invokeMock.mock.calls.find((c) => c[0] === "key_identity_sign_profile_card");
    expect(card?.[1]).toMatchObject({
      card: {
        version: 1,
        displayName: "Ada",
        relays: ["http://localhost:8080"],
        certificates: [],
      },
    });
  });

  it("treats a lost answer as success when the server shows the draft's id", async () => {
    backend(
      {
        KeyLoginChallenge: CHALLENGE,
        EnrollIdentityKey: new TypeError("Failed to fetch"),
        MeKeyAccount: ME(PRINCIPAL),
        MyKeyIdentity: identity,
        PublishProfileCard: { publishProfileCard: { version: 1 } },
      },
      { key_identity_sign_enrollment: statements, key_identity_sign_profile_card: STATEMENT },
    );
    await completeEnrollment(draft, ACCOUNT);
    expect(commands()).toContain("key_identity_settle");
  });

  it("fails, keeping the draft, when the server refused it", async () => {
    backend(
      {
        KeyLoginChallenge: CHALLENGE,
        EnrollIdentityKey: serverError("VALIDATION"),
        MeKeyAccount: ME(null),
      },
      { key_identity_sign_enrollment: statements },
    );
    await expect(completeEnrollment(draft, ACCOUNT)).rejects.toBeInstanceOf(ClientError);
    expect(commands()).toEqual(["key_identity_sign_enrollment"]);
  });

  it("removes nothing while an enrollment is still in flight", async () => {
    let answer: (value: unknown) => void = () => undefined;
    backend(
      {
        KeyLoginChallenge: CHALLENGE,
        EnrollIdentityKey: () => new Promise((resolve) => (answer = resolve)),
        MeKeyAccount: ME(null),
        MyKeyIdentity: new TypeError("Failed to fetch"),
      },
      { key_identity_sign_enrollment: statements },
    );
    const enrolling = completeEnrollment(draft, ACCOUNT);
    await vi.waitFor(() => expect(answer).not.toBeNull());
    await vi.waitFor(() =>
      expect(requestMock.mock.calls.some((c) => operation(c) === "EnrollIdentityKey")).toBe(true),
    );

    // The settings panel closes now: the server still says "not enrolled".
    await abandonEnrollment(draft, ACCOUNT);
    expect(await reconcileDeviceKeys(ACCOUNT)).toBeNull();
    expect(commands()).toEqual(["key_identity_sign_enrollment"]);

    answer({ enrollIdentityKey: true });
    await enrolling;
    expect(commands()).toContain("key_identity_settle");
    expect(commands()).not.toContain("key_identity_discard_enrollment");
  });

  it("abandoning removes the keys only when the server is known not to use them", async () => {
    backend({ MeKeyAccount: ME(null) });
    await abandonEnrollment(draft, ACCOUNT);
    expect(commands()).toEqual(["key_identity_discard_enrollment"]);

    invokeMock.mockClear();
    backend({ MeKeyAccount: ME(PRINCIPAL) });
    await abandonEnrollment(draft, ACCOUNT);
    expect(commands()).toEqual(["key_identity_settle"]);

    invokeMock.mockClear();
    backend({ MeKeyAccount: new TypeError("Failed to fetch") });
    await abandonEnrollment(draft, ACCOUNT);
    expect(commands()).toEqual([]);
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
  const created = { signupWithKey: { userId: "user-1", serverId: "srv-1" } };
  const LOG = { keyLog: [{ seq: 0, statement: STATEMENT }] };

  it("stores and signs the draft's keys, creates the account, settles and publishes the card", async () => {
    backend(
      {
        KeyLoginChallenge: CHALLENGE,
        SignupWithKey: created,
        MyKeyIdentity: identity,
        PublishProfileCard: { publishProfileCard: { version: 1 } },
      },
      { key_identity_sign_signup: statements, key_identity_sign_profile_card: STATEMENT },
    );

    await expect(signupWithKey(draft, fields)).resolves.toEqual({
      userId: "user-1",
      serverId: "srv-1",
    });
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
      },
    });
    expect(invokeMock).toHaveBeenCalledWith("key_identity_settle", {
      account: { endpoint: ENDPOINT, userId: "user-1", username: "ada" },
      principalId: PRINCIPAL,
    });
    expect(commands()).toEqual([
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
    await expect(signupWithKey(draft, fields)).resolves.toEqual({
      userId: "user-1",
      serverId: "srv-1",
    });
  });

  it("marks a failed challenge, before anything is signed or sent", async () => {
    backend({ KeyLoginChallenge: serverError("RATE_LIMITED") });
    const failure = await signupWithKey(draft, fields).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(KeyChallengeFailed);
    expect((failure as KeyChallengeFailed).reason).toBeInstanceOf(ClientError);
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
    await expect(signupWithKey(draft, fields)).rejects.toBeInstanceOf(ClientError);
    expect(commands()).toEqual(["key_identity_sign_signup", "key_identity_remove_draft_keys"]);
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
    await expect(signupWithKey(draft, fields)).resolves.toEqual({
      userId: "user-1",
      serverId: null,
    });
    expect(commands()).toEqual([
      "key_identity_sign_signup",
      "key_identity_restore_draft_keys",
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
    await expect(signupWithKey(draft, fields)).rejects.toBe(refused);
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
    await expect(signupWithKey(draft, fields)).rejects.toBeInstanceOf(TypeError);
    expect(commands()).toEqual(["key_identity_sign_signup"]);
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
    await expect(signupWithKey(draft, fields)).rejects.toBeInstanceOf(TypeError);
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
    await expect(discardKeySignup(draft)).resolves.toEqual({ userId: "user-1", serverId: null });
    expect(commands()).toEqual([
      "key_identity_restore_draft_keys",
      "key_identity_sign_login",
      "key_identity_settle",
    ]);
  });

  it("discarding removes the keys only when no account here holds them", async () => {
    backend({ KeyLog: { keyLog: [] } });
    await expect(discardKeySignup(draft)).resolves.toBeNull();
    expect(commands()).toEqual(["key_identity_discard_enrollment"]);

    invokeMock.mockClear();
    backend({ KeyLog: new TypeError("Failed to fetch") });
    await expect(discardKeySignup(draft)).resolves.toBeNull();
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
    await expect(signupWithKey(draft, fields)).rejects.toBeInstanceOf(ClientError);
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
    const signingUp = signupWithKey(draft, fields);
    await vi.waitFor(() =>
      expect(requestMock.mock.calls.some((c) => operation(c) === "SignupWithKey")).toBe(true),
    );

    await abandonKeySignup(draft);
    await expect(discardKeySignup(draft)).resolves.toBeNull();
    expect(
      await forgetKeysTheServerNeverSaw({ ...LOCAL_UNCONFIRMED, principalId: PRINCIPAL }),
    ).toBe(false);
    expect(commands()).toEqual(["key_identity_sign_signup"]);

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

    await expect(signupWithKey(draft, { username: "ada" }, { onProofOfWork })).resolves.toEqual({
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
    expect(commands().slice(0, 4)).toEqual([
      "relay_direct_discovery",
      "relay_verify_discovery",
      "relay_solve_pow",
      "key_identity_sign_signup",
    ]);
    // The proof is found before the challenge is asked for, so it cannot expire meanwhile.
    expect(requestMock.mock.calls.map(operation)[0]).toBe("KeyLoginChallenge");
    expect(invokeMock.mock.invocationCallOrder[2]).toBeLessThan(
      requestMock.mock.invocationCallOrder[0],
    );
    expect(sentInput()).toMatchObject({ username: "ada", proofOfWork: NONCE });
  });

  it.each([
    ["an instance invite", { instanceInviteToken: "inst-tok" }],
    ["a workspace invite", { workspaceInviteToken: "ws-tok" }],
    ["a bootstrap token", { bootstrapToken: "boot-tok" }],
  ])("skips the proof with %s", async (_case, token) => {
    backend(server(), {
      key_identity_sign_signup: statements,
      key_identity_sign_profile_card: STATEMENT,
    });
    await signupWithKey(draft, { username: "ada", ...token });
    expect(commands().filter((c) => c.startsWith("relay_"))).toEqual([]);
    expect(sentInput()).toEqual(expect.objectContaining(token));
    expect(sentInput()).not.toHaveProperty("proofOfWork");
  });

  it.each([
    ["in open mode", { relay_verify_discovery: discovery({ mode: "open", powBits: null }) }],
    [
      "when the discovery document cannot be read",
      { relay_verify_discovery: new Error("server discovery: malformed") },
    ],
  ])("sends no proof %s", async (_case, answers) => {
    backend(server(), {
      relay_direct_discovery: "document",
      ...answers,
      key_identity_sign_signup: statements,
      key_identity_sign_profile_card: STATEMENT,
    });
    await signupWithKey(draft, { username: "ada" });
    expect(commands()).not.toContain("relay_solve_pow");
    expect(sentInput()).not.toHaveProperty("proofOfWork");
  });

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
    await expect(signupWithKey(draft, { username: "ada" })).rejects.toBeInstanceOf(ClientError);
    expect(sentInput(0)).toMatchObject({ proofOfWork: "nonce-1" });

    const refused = serverError("VALIDATION");
    refused.response.errors![0].message =
      "proofOfWork does not have the required leading zero bits";
    backend(server(refused), tauri);
    await expect(signupWithKey(draft, { username: "ada2" })).rejects.toBeInstanceOf(ClientError);
    expect(sentInput(1)).toMatchObject({ proofOfWork: "nonce-1" });
    expect(solved).toBe(1);

    backend(server(), tauri);
    await signupWithKey(draft, { username: "ada2" });
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
    const signup = signupWithKey(draft, { username: "ada" }, { signal: stop.signal });
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

describe("recoverAccount", () => {
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

  it("reads the public log, rotates with the recovery key and signs in with the new device", async () => {
    backend(
      {
        KeyLog: { keyLog: [{ seq: 0, statement: STATEMENT }] },
        RotateIdentityKey: { rotateIdentityKey: { principalId: PRINCIPAL, keySeq: 1 } },
        KeyLoginChallenge: CHALLENGE,
        LoginWithKey: { loginWithKey: { userId: "user-1" } },
        MeKeyAccount: ME(PRINCIPAL),
      },
      { key_identity_begin_recovery: recovery, key_identity_sign_login: STATEMENT },
    );

    await expect(recoverAccount(kit, null, "New laptop")).resolves.toBe("user-1");
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
    await expect(recoverAccount(kit, null, "New")).rejects.toBeInstanceOf(ClientError);
    expect(invokeMock).toHaveBeenCalledWith("key_identity_discard_recovery", {
      principalId: PRINCIPAL,
      deviceId: "d-new",
    });
    expect(commands()).not.toContain("key_identity_forget");
  });

  it("signs in when the rotation landed although its answer was an error", async () => {
    let logReads = 0;
    backend(
      {
        KeyLog: () => (logReads++ === 0 ? before : after),
        RotateIdentityKey: serverError("INTERNAL"),
        KeyLoginChallenge: CHALLENGE,
        LoginWithKey: { loginWithKey: { userId: "user-1" } },
        MeKeyAccount: ME(PRINCIPAL),
      },
      { key_identity_begin_recovery: recovery, key_identity_sign_login: STATEMENT },
    );
    await expect(recoverAccount(kit, null, "New")).resolves.toBe("user-1");
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
    await expect(recoverAccount(kit, null, "New")).rejects.toBeInstanceOf(TypeError);
    expect(commands()).not.toContain("key_identity_discard_recovery");
    expect(commands()).not.toContain("key_identity_forget");
  });

  it("needs an account id and passes on a bad kit", async () => {
    await expect(recoverAccount("RK1-AAAA", null, "New")).rejects.toThrow(/account id/);
    backend(
      { KeyLog: { keyLog: [] } },
      { key_identity_begin_recovery: new Error("this recovery key has a typo") },
    );
    await expect(recoverAccount("RK1-AAAA", PRINCIPAL, "New")).rejects.toThrow(/typo/);
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
    expect(profileCardIsStale(identity(card, [device]), "Ada")).toBe(false);
    expect(profileCardIsStale(identity(null, [device]), "Ada")).toBe(true);
    expect(profileCardIsStale(identity(card, [device]), "Ada L.")).toBe(true);
    expect(profileCardIsStale(identity({ ...card, keySeq: 1 }, [device]), "Ada")).toBe(true);
    expect(
      profileCardIsStale(identity(card, [{ ...device, revokedAt: "2026-10-09T01:00:00Z" }]), "Ada"),
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
    expect(profileCardRelays(chosen)).toEqual(["https://relay.example", "http://localhost:8080"]);
    expect(profileCardIsStale(chosen, "Ada")).toBe(false);
    const elsewhere = identity(card(["https://relay.example"]), [device]);
    expect(profileCardRelays(elsewhere)).toEqual([
      "http://localhost:8080",
      "https://relay.example",
    ]);
    expect(profileCardIsStale(elsewhere, "Ada")).toBe(true);
    expect(profileCardRelays(identity(null, [device]))).toEqual(["http://localhost:8080"]);
  });
});
