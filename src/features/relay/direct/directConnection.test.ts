import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceEvent } from "../../../core/events/types";
import { asMessage, CONV, HOST, messageItem, processorFor, SPACE } from "../../../test/relayItems";
import type { ServerPin } from "../state/relayDb";
import type { RelayStreamProcessor } from "../stream/relayStream";
import {
  DirectConnections,
  directDecisions,
  PROBES_TO_RETURN,
  RELAY_FAILURE_MS,
  useDirectStore,
  type DirectDeps,
  type TriggerInput,
} from "./directConnection";
import type { DirectTransport } from "./directTransport";

const base: TriggerInput = {
  hosts: [HOST],
  failingFor: () => 0,
  relayDownFor: 0,
  missing: [],
  connected: [],
  consent: {},
  asked: [],
};

describe("when to connect directly", () => {
  it("waits 60 seconds of relay failures, then asks", () => {
    expect(directDecisions({ ...base, failingFor: () => RELAY_FAILURE_MS - 1 })).toEqual({
      connect: [],
      ask: [],
    });
    expect(directDecisions({ ...base, failingFor: () => RELAY_FAILURE_MS })).toEqual({
      connect: [],
      ask: [HOST],
    });
  });

  it("asks when the relay's socket is down 60 seconds or messages stay missing", () => {
    expect(directDecisions({ ...base, relayDownFor: RELAY_FAILURE_MS }).ask).toEqual([HOST]);
    expect(directDecisions({ ...base, missing: [HOST] }).ask).toEqual([HOST]);
  });

  it("asks once per host and remembers the answer", () => {
    const failing = { ...base, missing: [HOST] };
    expect(directDecisions({ ...failing, asked: [HOST] })).toEqual({ connect: [], ask: [] });
    expect(directDecisions({ ...failing, consent: { [HOST]: "yes" } })).toEqual({
      connect: [HOST],
      ask: [],
    });
    expect(directDecisions({ ...failing, consent: { [HOST]: "no" } })).toEqual({
      connect: [],
      ask: [],
    });
    expect(directDecisions({ ...failing, connected: [HOST] })).toEqual({ connect: [], ask: [] });
  });
});

const pin: ServerPin = {
  serverId: HOST,
  origin: "https://host.example",
  log: [],
  hashes: [],
  keys: [],
  signers: [],
  previousKeyUntil: null,
  descriptorVersion: 1,
  endpoints: { graphql: "https://host.example/api", websocket: "wss://host.example/api/ws" },
  status: "active",
  pinnedAt: 0,
  fetchedAt: 0,
};

function harness() {
  const stored = new Map<string, number>();
  const applied: string[] = [];
  const processor = processorFor(stored, applied);
  const calls: string[] = [];
  let heads = 0;
  const transport: DirectTransport = {
    sessions: true,
    discovery: vi.fn(async () => "{}"),
    open: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    graphql: vi.fn(async (_server: string, body: string) => {
      const query = String((JSON.parse(body) as { query: string }).query);
      const answer = query.includes("keyLoginChallenge")
        ? { keyLoginChallenge: { challengeId: "c1", nonce: "n1" } }
        : query.includes("loginWithKey")
          ? { loginWithKey: { userId: "remote-user" } }
          : query.includes("streamHeads")
            ? { streamHeads: [{ stream: `c:${CONV}`, seq: String(heads) }] }
            : {};
      calls.push(Object.keys(answer)[0] ?? "other");
      return { status: 200, body: JSON.stringify({ data: answer }), contentType: null };
    }),
    sockets: { open: vi.fn(), send: vi.fn(), close: vi.fn() },
  };
  let onEvent: ((event: WorkspaceEvent, spaceId: string) => void) | null = null;
  let relayUp = false;
  const deps: DirectDeps = {
    transport,
    principalId: "rimp1_me",
    loadPin: vi.fn(async () => pin),
    pinDiscovery: vi.fn(async () => pin),
    signLogin: vi.fn(async () => ({ payload: "proof", signature: "sig" })),
    spacesOf: () => [SPACE],
    processor: () => processor as RelayStreamProcessor,
    openEvents: vi.fn((_host, _spaces, handler) => {
      onEvent = handler;
      return () => {
        onEvent = null;
      };
    }),
    apply: (event) => {
      applied.push(String((event as { message_id?: string }).message_id));
    },
    probeRelay: vi.fn(async () => {
      if (!relayUp) throw new Error("down");
    }),
    renew: vi.fn(async () => undefined),
    saveConsent: vi.fn(async () => undefined),
    now: () => 1_000,
  };
  return {
    processor,
    applied,
    transport,
    deps,
    calls,
    connections: new DirectConnections(deps),
    direct: (seq: number) =>
      onEvent?.(
        {
          type: "MessageDeleted",
          workspace_id: SPACE,
          conversation_id: CONV,
          message_id: `m${seq}`,
        } as unknown as WorkspaceEvent,
        SPACE,
      ),
    setHeads: (seq: number) => {
      heads = seq;
    },
    setRelayUp: (up: boolean) => {
      relayUp = up;
    },
  };
}

beforeEach(() => useDirectStore.getState().reset());

describe("a direct connection", () => {
  it("signs in to the host with a proof for its server id and shows the banner", async () => {
    const h = harness();
    await h.connections.connect(HOST);
    expect(h.transport.open).toHaveBeenCalledWith(HOST, pin.endpoints);
    expect(h.deps.signLogin).toHaveBeenCalledWith(HOST, { challengeId: "c1", nonce: "n1" });
    expect(h.calls).toEqual(["keyLoginChallenge", "loginWithKey"]);
    expect(useDirectStore.getState().connected[HOST]).toBe(1_000);
    expect(h.connections.send("rims1_other", "{}")).toBeNull();
    expect(h.connections.send(HOST, "{}")).not.toBeNull();
  });

  it("asks before connecting and remembers the answer", async () => {
    const h = harness();
    h.connections.ask(HOST);
    expect(useDirectStore.getState().offer).toBe(HOST);
    await h.connections.answer(HOST, "yes");
    expect(h.deps.saveConsent).toHaveBeenCalledWith(HOST, "yes");
    expect(useDirectStore.getState().consent[HOST]).toBe("yes");
    expect(HOST in useDirectStore.getState().connected).toBe(true);
  });

  it("refuses where the platform cannot hold a session", async () => {
    const h = harness();
    const web = new DirectConnections({
      ...h.deps,
      transport: { ...h.transport, sessions: false, sockets: null },
    });
    await expect(web.connect(HOST)).rejects.toThrow(/desktop app/);
  });

  it("switches back after two good probes, deduplicating by host, stream and seq", async () => {
    const h = harness();
    await h.processor.push(asMessage(await messageItem(1)));
    await h.connections.connect(HOST);

    // The host's own socket delivers 2 and 3; the relay queues 2, 3 and 4 meanwhile.
    h.direct(2);
    h.direct(3);
    for (const seq of [2, 3, 4]) await h.processor.push(asMessage(await messageItem(seq)));
    expect(h.applied).toEqual(["m1", "m2", "m3"]);

    await h.connections.probe();
    expect(HOST in useDirectStore.getState().connected).toBe(true);
    h.setRelayUp(true);
    h.setHeads(3);
    for (let i = 0; i < PROBES_TO_RETURN; i++) await h.connections.probe();

    expect(h.deps.renew).toHaveBeenCalledWith(HOST);
    expect(h.transport.close).toHaveBeenCalledWith(HOST);
    expect(HOST in useDirectStore.getState().connected).toBe(false);
    expect(h.applied).toEqual(["m1", "m2", "m3", "m4"]);

    // Later items flow through the relay as before.
    await h.processor.push(asMessage(await messageItem(5)));
    expect(h.applied).toEqual(["m1", "m2", "m3", "m4", "m5"]);
  });

  it("starts the probes over when the relay fails again", async () => {
    const h = harness();
    await h.connections.connect(HOST);
    h.setRelayUp(true);
    await h.connections.probe();
    h.setRelayUp(false);
    await h.connections.probe();
    h.setRelayUp(true);
    await h.connections.probe();
    expect(HOST in useDirectStore.getState().connected).toBe(true);
    await h.connections.probe();
    expect(HOST in useDirectStore.getState().connected).toBe(false);
  });
});
