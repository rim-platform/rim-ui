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

/** The new relay has no account for this identity yet and takes the signup. */
function answerSignup() {
  directRequest.mockImplementation(async (_serverId: string, doc: string) => {
    const name = /(?:query|mutation)\s+(\w+)/.exec(String(doc))?.[1];
    if (name === "KeyLoginChallenge") {
      return { keyLoginChallenge: { challengeId: "c-1", nonce: "n-1" } };
    }
    if (name === "LoginWithKey") throw new Error("no account");
    if (name === "SignupWithKey") return { signupWithKey: { userId: "u-new" } };
    throw new Error(`unexpected ${name}`);
  });
}

function signupInput(): Record<string, unknown> | undefined {
  const call = directRequest.mock.calls.find((c) => /SignupWithKey/.test(String(c[1])));
  return (call?.[2] as { input: Record<string, unknown> } | undefined)?.input;
}

beforeEach(() => {
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
    const deps = liveDeps("Ada");

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
    });
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
    const deps = liveDeps("Ada");

    const checked = await deps.checkNew("https://host.example");
    await deps.enterNew(checked.serverId, "ada");

    expect(solveProofOfWork).not.toHaveBeenCalled();
    expect(signupInput()).not.toHaveProperty("proofOfWork");
  });
});
