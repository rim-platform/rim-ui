import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import vectors from "../../../../protocol/relay-vectors.json";
import { replayServerLog } from "../crypto/serverStatements";

const remoteServer = vi.hoisted(() => vi.fn());
vi.mock("../api/relayApi", () => ({ fetchRemoteServer: remoteServer }));
const ownDiscovery = vi.hoisted(() => vi.fn());
vi.mock("./serverOrigin", () => ({ readOwnDiscovery: ownDiscovery }));

import {
  ensurePinned,
  hostKeyAt,
  keyAt,
  nextPin,
  pinServer,
  resetPinCache,
  ServerForkedError,
} from "./serverPins";
import { useRelayStore } from "./useRelayStore";

const host = vectors.host;
const DAY = 24 * 60 * 60 * 1000;

function discovery(log: unknown[], descriptor: unknown): string {
  return JSON.stringify({ rim: "server-discovery", keyLog: log, descriptor });
}

function serve(log: unknown[], descriptor: unknown) {
  remoteServer.mockResolvedValue({
    serverId: host.serverId,
    origin: "https://host.example",
    discovery: discovery(log, descriptor),
  });
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetPinCache();
  remoteServer.mockReset();
  ownDiscovery.mockReset();
  useRelayStore.getState().reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("nextPin", () => {
  it("pins on first use with no grace, then follows a server rotation with 24 hours of it", async () => {
    const one = await replayServerLog([host.inception]);
    const two = await replayServerLog([host.inception, host.rotation]);
    const first = nextPin(
      null,
      { origin: "o", log: [host.inception], head: one, descriptorVersion: 1 },
      1_000,
    );
    expect(first.previousKeyUntil).toBeNull();
    const rotated = nextPin(
      first,
      { origin: "o", log: [host.inception, host.rotation], head: two, descriptorVersion: 2 },
      2_000,
    );
    expect(rotated.keys).toHaveLength(2);
    expect(rotated.previousKeyUntil).toBe(2_000 + DAY);
    expect(rotated.pinnedAt).toBe(1_000);
    expect(keyAt(rotated, 1, 3_000)).toBe(rotated.keys[1]);
    expect(keyAt(rotated, 0, 3_000)).toBe(host.serverKey);
    expect(keyAt(rotated, 0, 2_000 + DAY)).toBeNull();
    // A shorter log keeps the pin.
    const prefix = nextPin(
      rotated,
      { origin: "o", log: [host.inception], head: one, descriptorVersion: 1 },
      4_000,
    );
    expect(prefix.keys).toHaveLength(2);
  });

  it("gives no grace to the key before a recovery", async () => {
    const one = await replayServerLog([host.inception]);
    const first = nextPin(null, { origin: "o", log: [], head: one, descriptorVersion: 1 }, 0);
    const recovered = {
      ...first,
      keys: [...first.keys, "ed25519:x"],
      signers: [null, "recovery" as const],
      previousKeyUntil: null,
    };
    expect(keyAt(recovered, 0, 0)).toBeNull();
  });
});

describe("pinServer", () => {
  it("verifies the discovery document and pins the server", async () => {
    serve([host.inception], host.descriptor);
    const pin = await pinServer("https://host.example", host.serverId);
    expect(pin.serverId).toBe(host.serverId);
    expect(await hostKeyAt(host.serverId, 0)).toBe(host.serverKey);
  });

  it("refuses another server than the one expected", async () => {
    serve([host.inception], host.descriptor);
    await expect(pinServer("https://host.example", vectors.relay.serverId)).rejects.toThrow(
      /another server/,
    );
  });

  it("stops using a server whose log forks, and says so", async () => {
    serve([host.inception, host.rotation], host.rotatedDescriptor);
    await pinServer("https://host.example");
    // Same inception, a different rotation at seq 1: a fork.
    const { keyFromSeed } = await import("../../../test/ed25519");
    const { sign } = await import("../../key-identity/browser/statements");
    const { RELAY_CONTEXT } = await import("../crypto/serverStatements");
    const other = host.rotation.payload.replace(
      "-kg0FH9uaQw2k-_2EzYEZAPNiuKhTzGzxAc1hWkjlWU",
      (await keyFromSeed(42)).publicKey.slice("ed25519:".length),
    );
    const forkRotation = await sign(
      (await keyFromSeed(40)).privateKey,
      RELAY_CONTEXT.serverKey,
      other,
    );
    const forkHead = await replayServerLog([host.inception, forkRotation]);
    const descriptorPayload = host.rotatedDescriptor.payload;
    const descriptor = await sign(
      (await keyFromSeed(42)).privateKey,
      RELAY_CONTEXT.descriptor,
      descriptorPayload,
    );
    expect(forkHead.seq).toBe(1);
    resetPinCache();
    serve([host.inception, forkRotation], descriptor);
    await expect(pinServer("https://host.example")).rejects.toBeInstanceOf(ServerForkedError);
    expect(useRelayStore.getState().forked).toContain(host.serverId);
    await expect(ensurePinned(host.serverId, [])).rejects.toBeInstanceOf(ServerForkedError);
  });

  it("refetches once for a newer keySeq and accepts the extension", async () => {
    serve([host.inception], host.descriptor);
    await pinServer("https://host.example");
    serve([host.inception, host.rotation], host.rotatedDescriptor);
    // At most one fetch a minute.
    await expect(hostKeyAt(host.serverId, 1)).rejects.toThrow(/does not accept/);
    const later = Date.now() + 61_000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    const key = await hostKeyAt(host.serverId, 1);
    expect(key).toBe("ed25519:-kg0FH9uaQw2k-_2EzYEZAPNiuKhTzGzxAc1hWkjlWU");
    // The old key is still good within the grace after this app saw the rotation.
    expect(await hostKeyAt(host.serverId, 0)).toBe(host.serverKey);
  });

  it("pins a DM home from the first relay URL that serves it", async () => {
    remoteServer.mockImplementation(async (origin: string) => {
      if (origin === "https://down.example") throw new Error("unreachable");
      return {
        serverId: host.serverId,
        origin,
        discovery: discovery([host.inception], host.descriptor),
      };
    });
    const pin = await ensurePinned(host.serverId, ["https://down.example", "https://host.example"]);
    expect(pin.origin).toBe("https://host.example");
  });
});

describe("pinning this app's own server", () => {
  /** This app signed in to `host`, whose discovery document it reads directly. */
  function signedInTo(log: unknown[], descriptor: unknown) {
    useRelayStore.setState({
      info: { serverId: host.serverId, roles: ["host", "relay"], directSpaceId: "space-direct" },
    });
    ownDiscovery.mockResolvedValue({
      origin: "https://host.example",
      document: discovery(log, descriptor),
    });
  }

  it("pins it from its own discovery document, never asking it to fetch itself", async () => {
    signedInTo([host.inception], host.descriptor);
    const pin = await ensurePinned(host.serverId, ["https://host.example"]);
    expect(pin.serverId).toBe(host.serverId);
    expect(await hostKeyAt(host.serverId, 0)).toBe(host.serverKey);
    expect(ownDiscovery).toHaveBeenCalledTimes(1);
    expect(remoteServer).not.toHaveBeenCalled();
  });

  it("reads its own document again for a newer keySeq", async () => {
    signedInTo([host.inception], host.descriptor);
    await ensurePinned(host.serverId, []);
    signedInTo([host.inception, host.rotation], host.rotatedDescriptor);
    const key = await hostKeyAt(host.serverId, 1);
    expect(key).toBe("ed25519:-kg0FH9uaQw2k-_2EzYEZAPNiuKhTzGzxAc1hWkjlWU");
    expect(remoteServer).not.toHaveBeenCalled();
  });

  it("refuses a document of another server at its origin", async () => {
    useRelayStore.setState({
      info: { serverId: vectors.relay.serverId, roles: ["relay"], directSpaceId: "space-direct" },
    });
    ownDiscovery.mockResolvedValue({
      origin: "https://host.example",
      document: discovery([host.inception], host.descriptor),
    });
    await expect(ensurePinned(vectors.relay.serverId, [])).rejects.toThrow(/another server/);
  });

  it("still pins other servers through the relay", async () => {
    signedInTo([host.inception], host.descriptor);
    useRelayStore.setState({
      info: { serverId: vectors.relay.serverId, roles: ["relay"], directSpaceId: "space-direct" },
    });
    serve([host.inception], host.descriptor);
    await ensurePinned(host.serverId, ["https://host.example"]);
    expect(remoteServer).toHaveBeenCalledWith("https://host.example");
    expect(ownDiscovery).not.toHaveBeenCalled();
  });
});
