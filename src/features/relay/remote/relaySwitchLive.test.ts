import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import powVectors from "../../../../protocol/pow-vectors.json";
import vectors from "../../../../protocol/relay-vectors.json";

const directRequest = vi.hoisted(() => vi.fn());
vi.mock("../direct/directGraphql", () => ({ directRequest }));

const solveProofOfWork = vi.hoisted(() => vi.fn());
vi.mock("../pow/proofOfWork", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../pow/proofOfWork")>()),
  solveProofOfWork,
}));

// The desktop's account lock: the OPAQUE flows and the unlocks run on the Tauri side.
const lock = vi.hoisted(() => ({
  opaqueLoginStart: vi.fn(),
  opaqueLoginFinish: vi.fn(),
  opaqueRegistrationStart: vi.fn(),
  opaqueRegistrationFinish: vi.fn(),
  accountUnlockAfterLogin: vi.fn(),
  accountUnlockAfterSignup: vi.fn(),
}));
vi.mock("../../auth/api/accountLock", () => lock);

const identity = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("../../key-identity/api/keyIdentity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../key-identity/api/keyIdentity")>()),
  fetchMyKeyIdentity: async () => identity.value,
}));

const PROOF = { payload: "{}", signature: "ed25519:proof" };
vi.mock("../crypto/relayCrypto", async (importOriginal) => {
  const real = await importOriginal<typeof import("../crypto/relayCrypto")>();
  return {
    ...real,
    relayCrypto: () => ({ ...real.browserRelayCrypto, signLoginForServer: async () => PROOF }),
  };
});

import { setDirectTransport, type DirectTransport } from "../direct/directTransport";
import { resetPinCache } from "../state/serverPins";
import { useRelayStore } from "../state/useRelayStore";
import { liveDeps } from "./relaySwitchLive";

const RELAY_ORIGIN = "https://relay.example";
const INCEPTION = { payload: '{"v":2,"type":"inception","seq":0}', signature: "ed25519:inc" };
const CERT = { payload: '{"type":"device-cert"}', signature: "ed25519:cert" };

function serveDiscovery(descriptor: { payload: string; signature: string }) {
  const document = JSON.stringify({
    rim: "server-discovery",
    keyLog: [vectors.relay.inception],
    descriptor,
  });
  setDirectTransport({ discovery: async () => document } as unknown as DirectTransport);
}

const PASSWORD = { password: "correct horse battery", keep: true };

/** The new relay has no account for this identity yet and takes the signup. */
function answerSignup() {
  directRequest.mockImplementation(async (_serverId: string, doc: string) => {
    const name = /(?:query|mutation)\s+(\w+)/.exec(String(doc))?.[1];
    if (name === "PasswordLoginStart") {
      return { passwordLoginStart: { loginId: "login-1", response: "fake-response" } };
    }
    if (name === "PasswordRegistrationStart") {
      return { passwordRegistrationStart: "registration-response" };
    }
    if (name === "KeyLoginChallenge") {
      return { keyLoginChallenge: { challengeId: "c-1", nonce: "n-1" } };
    }
    if (name === "SignupWithKey") {
      return { signupWithKey: { userId: "u-new", serverShare: "share-new" } };
    }
    throw new Error(`unexpected ${name}`);
  });
  // No password finishes a login for a principal the relay has no account for.
  lock.opaqueLoginFinish.mockRejectedValue({
    kind: "backend_error",
    code: "WRONG_PASSWORD",
    message: "the password is wrong",
  });
}

function signupInput(): Record<string, unknown> | undefined {
  const call = directRequest.mock.calls.find((c) => /SignupWithKey/.test(String(c[1])));
  return (call?.[2] as { input: Record<string, unknown> } | undefined)?.input;
}

beforeEach(() => {
  Object.values(lock).forEach((fn) => fn.mockReset());
  lock.opaqueLoginStart.mockResolvedValue({ handle: "h-login", request: "credential-request" });
  lock.opaqueRegistrationStart.mockResolvedValue({
    handle: "h-registration",
    request: "registration-request",
  });
  lock.opaqueRegistrationFinish.mockResolvedValue({ upload: "registration-upload" });
  lock.accountUnlockAfterLogin.mockResolvedValue({ webStoreKey: "k", startedEmpty: false });
  lock.accountUnlockAfterSignup.mockResolvedValue({ webStoreKey: "k", startedEmpty: false });
  globalThis.indexedDB = new IDBFactory();
  resetPinCache();
  directRequest.mockReset();
  solveProofOfWork.mockReset();
  useRelayStore.setState({
    account: {
      endpoint: "https://old.example/api",
      userId: "u-old",
      principalId: "rimp1_ada",
      deviceId: "dev-1",
    },
  });
  identity.value = {
    principalId: "rimp1_ada",
    keySeq: 0,
    keyLog: [{ seq: 0, statement: INCEPTION }],
    devices: [{ deviceId: "dev-1", certificate: CERT }],
    profileCard: null,
  };
});

afterEach(() => {
  setDirectTransport(null);
  useRelayStore.setState({ account: null });
});

describe("switching to a relay in pow registration mode", () => {
  it("signs up with a proof-of-work over the log's inception, at the relay's difficulty", async () => {
    serveDiscovery(powVectors.powDescriptor);
    answerSignup();
    solveProofOfWork.mockResolvedValue("AAAAAAAAkaM");
    const deps = liveDeps("Ada", PASSWORD);

    const checked = await deps.checkNew(RELAY_ORIGIN);
    expect(checked.serverId).toBe(vectors.relay.serverId);
    await expect(deps.enterNew(checked.serverId, "ada")).resolves.toBe("u-new");

    expect(solveProofOfWork).toHaveBeenCalledWith({
      serverId: vectors.relay.serverId,
      inceptionPayload: INCEPTION.payload,
      bits: 16,
    });
    expect(signupInput()).toMatchObject({
      username: "ada",
      keyLog: [INCEPTION],
      device: CERT,
      proofOfWork: "AAAAAAAAkaM",
      passwordRegistration: "registration-upload",
      // Kept, with the keep key this app holds, as the direct sign-in is.
      keepSignedIn: true,
      keepKeyHeld: true,
    });
    // The password is registered there, and the data key wrapped under that relay's share.
    expect(lock.opaqueRegistrationStart).toHaveBeenCalledWith(PASSWORD.password);
    expect(lock.opaqueRegistrationFinish).toHaveBeenCalledWith(
      "h-registration",
      "registration-response",
    );
    expect(lock.accountUnlockAfterSignup).toHaveBeenCalledWith(
      "h-registration",
      "rimp1_ada",
      "share-new",
      null,
      true,
    );
  });

  it("sends no proof to a relay in another mode", async () => {
    // The host vector's descriptor, served at its own origin: invite mode.
    const document = JSON.stringify({
      rim: "server-discovery",
      keyLog: [vectors.host.inception],
      descriptor: vectors.host.descriptor,
    });
    setDirectTransport({ discovery: async () => document } as unknown as DirectTransport);
    answerSignup();
    const deps = liveDeps("Ada", PASSWORD);

    const checked = await deps.checkNew("https://host.example");
    await deps.enterNew(checked.serverId, "ada");

    expect(solveProofOfWork).not.toHaveBeenCalled();
    expect(signupInput()).not.toHaveProperty("proofOfWork");
  });

  it("searches no proof and sends no signup to a relay whose discovery document says it is full", async () => {
    const document = JSON.stringify({
      rim: "server-discovery",
      keyLog: [vectors.relay.inception],
      descriptor: powVectors.powDescriptor,
      registration: { full: true },
    });
    setDirectTransport({ discovery: async () => document } as unknown as DirectTransport);
    answerSignup();
    const deps = liveDeps("Ada", PASSWORD);

    const checked = await deps.checkNew(RELAY_ORIGIN);
    await expect(deps.enterNew(checked.serverId, "ada")).rejects.toThrow(/full/);

    expect(solveProofOfWork).not.toHaveBeenCalled();
    expect(signupInput()).toBeUndefined();
  });
});

describe("entering a relay that has the account", () => {
  it("checks the password there before the device proof, and wraps the data key under its share", async () => {
    serveDiscovery(powVectors.powDescriptor);
    directRequest.mockImplementation(async (_serverId: string, doc: string) => {
      const name = /(?:query|mutation)\s+(\w+)/.exec(String(doc))?.[1];
      if (name === "PasswordLoginStart") {
        return { passwordLoginStart: { loginId: "login-1", response: "credential-response" } };
      }
      if (name === "PasswordLoginFinish") {
        return {
          passwordLoginFinish: { ticket: "ticket-1", serverShare: "sealed", rewraps: ["rw"] },
        };
      }
      if (name === "KeyLoginChallenge") {
        return { keyLoginChallenge: { challengeId: "c-1", nonce: "n-1" } };
      }
      if (name === "LoginWithKey") return { loginWithKey: { userId: "u-there" } };
      throw new Error(`unexpected ${name}`);
    });
    lock.opaqueLoginFinish.mockResolvedValue({ finalization: "finalization" });
    const deps = liveDeps("Ada", PASSWORD);

    const checked = await deps.checkNew(RELAY_ORIGIN);
    await expect(deps.enterNew(checked.serverId, "ada")).resolves.toBe("u-there");

    expect(lock.accountUnlockAfterLogin).toHaveBeenCalledWith(
      "h-login",
      "rimp1_ada",
      "sealed",
      ["rw"],
      true,
    );
    const login = directRequest.mock.calls.find((c) => /LoginWithKey/.test(String(c[1])));
    expect(login?.[2]).toEqual({ proof: PROOF, passwordTicket: "ticket-1" });
    expect(lock.accountUnlockAfterLogin.mock.invocationCallOrder[0]).toBeLessThan(
      directRequest.mock.invocationCallOrder[directRequest.mock.calls.indexOf(login!)],
    );
    expect(lock.opaqueRegistrationStart).not.toHaveBeenCalled();
  });

  it("says the password is wrong when the relay holds the account under another one", async () => {
    serveDiscovery(powVectors.powDescriptor);
    answerSignup();
    const answer = directRequest.getMockImplementation()!;
    directRequest.mockImplementation(async (serverId: string, doc: string) => {
      if (/PasswordRegistrationStart/.test(String(doc))) {
        const { ClientError } = await import("graphql-request");
        throw new ClientError(
          {
            status: 200,
            headers: new Headers(),
            errors: [{ message: "taken", extensions: { code: "CONFLICT" } }],
          },
          { query: "" },
        );
      }
      return answer(serverId, doc);
    });
    const deps = liveDeps("Ada", PASSWORD);

    const checked = await deps.checkNew(RELAY_ORIGIN);
    await expect(deps.enterNew(checked.serverId, "ada")).rejects.toThrow("Wrong password");
    expect(signupInput()).toBeUndefined();
  });
});
