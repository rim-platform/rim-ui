import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClientError } from "graphql-request";

const requestMock = vi.fn();
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));

const invokeMock = vi.fn();
vi.mock("../../../core/tauri/safeInvoke", () => ({
  safeInvoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  abandonEnrollment,
  accountIdInKit,
  completeEnrollment,
  profileCardIsStale,
  reconcileDeviceKeys,
  recoverAccount,
  resumeWithDeviceKey,
  signInWithDeviceKey,
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
  const draft: EnrollmentDraft = { draftId: "draft-1", principalId: PRINCIPAL, recoveryKit: "kit" };
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
});
