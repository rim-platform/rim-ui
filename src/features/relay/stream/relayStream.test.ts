import { describe, expect, it, vi } from "vitest";

import vectors from "../../../../protocol/relay-vectors.json";
import { keyFromSeed } from "../../../test/ed25519";
import { sign } from "../../key-identity/browser/statements";
import { browserRelayCrypto } from "../crypto/relayCrypto";
import { RELAY_CONTEXT } from "../crypto/serverStatements";
import { HOLD_MS } from "./sequencer";
import { cardRelays, RelayStreamProcessor, type RelayStreamDeps } from "./relayStream";

const HOST = vectors.host.serverId;
const HOST_KEY = vectors.host.serverKey;
const ME = "rimp1_me";
const SPACE = "0199d1a0-0000-7000-8000-000000000002";
const CONV = "0199d1a0-0000-7000-8000-000000000003";

let nextId = 1;

async function item(
  stream: string,
  seq: number | null,
  event: Record<string, unknown>,
  overrides: { host?: string; workspaceId?: string; seed?: number } = {},
) {
  const payload = JSON.stringify({
    v: 2,
    type: "host-event",
    host: overrides.host ?? HOST,
    keySeq: 0,
    workspaceId: overrides.workspaceId ?? SPACE,
    stream,
    seq,
    event: { workspace_id: SPACE, ...event },
    issuedAt: "2026-10-09T00:00:00Z",
  });
  const key = await keyFromSeed(overrides.seed ?? vectors.host.seed);
  const envelope = await sign(key.privateKey, RELAY_CONTEXT.hostEvent, payload);
  return JSON.stringify({
    type: "RelayItem",
    id: String(nextId++),
    hostServerId: HOST,
    workspaceId: SPACE,
    envelope,
  });
}

function message(seq: number, text = `m${seq}`) {
  return item(`c:${CONV}`, seq, {
    type: "MessageDeleted",
    conversation_id: CONV,
    message_id: text,
  });
}

function setup(overrides: Partial<RelayStreamDeps> = {}) {
  let now = 0;
  const spaces = new Map<string, string>([[SPACE, HOST]]);
  const stored = new Map<string, number>();
  const applied: string[] = [];
  const deps: RelayStreamDeps = {
    crypto: browserRelayCrypto,
    principalId: ME,
    hostOf: (id) => spaces.get(id) ?? null,
    registerSpace: vi.fn(async (id: string, host: string) => {
      spaces.set(id, host);
      return true;
    }),
    ensurePinned: vi.fn(async () => undefined),
    hostKeyAt: vi.fn(async () => HOST_KEY),
    loadLast: async (key) => stored.get(key) ?? null,
    saveLast: async (key, seq) => {
      stored.set(key, seq);
    },
    streamHeads: vi.fn(async () => new Map<string, number>()),
    refetchSpace: vi.fn(async () => undefined),
    apply: vi.fn((event) => {
      applied.push(String((event as { message_id?: string }).message_id ?? event.type));
    }),
    ack: vi.fn(async () => undefined),
    onMissing: vi.fn(),
    onReconciled: vi.fn(),
    onDmRequest: vi.fn(),
    onForked: vi.fn(),
    now: () => now,
    ...overrides,
  };
  return {
    deps,
    applied,
    spaces,
    processor: new RelayStreamProcessor(deps),
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("RelayStreamProcessor", () => {
  it("applies verified events in order and acknowledges them", async () => {
    const { processor, applied, deps } = setup();
    await processor.push(await message(1));
    await processor.push(await message(2));
    expect(applied).toEqual(["m1", "m2"]);
    expect(deps.ack).toHaveBeenLastCalledWith(processor.ackedThrough);
  });

  it("drops an event signed by another key, on the wrong stream, or for another space", async () => {
    const { processor, applied, deps } = setup();
    await processor.push(await item(`c:${CONV}`, 1, { type: "NewMessage" }, { seed: 30 }));
    await processor.push(
      await item("c:another", 1, { type: "MessageDeleted", conversation_id: CONV }),
    );
    await processor.push(
      await item(
        `c:${CONV}`,
        1,
        { type: "MessageDeleted", conversation_id: CONV },
        {
          workspaceId: "someone-elses",
        },
      ),
    );
    expect(applied).toEqual([]);
    // Dropped items are still acknowledged.
    expect(deps.ack).toHaveBeenCalled();
  });

  it("holds a gap, keeps the acknowledgement back, and releases it when the event arrives", async () => {
    const { processor, applied, deps } = setup();
    await processor.push(await message(1));
    const acked = processor.ackedThrough;
    await processor.push(await message(3));
    expect(applied).toEqual(["m1"]);
    expect(processor.ackedThrough).toBe(acked);
    await processor.push(await message(2));
    expect(applied).toEqual(["m1", "m2", "m3"]);
    expect(deps.ack).toHaveBeenLastCalledWith(processor.ackedThrough);
  });

  it("reconciles a gap held too long through the host and applies what is above the head", async () => {
    const streamHeads = vi.fn(async () => new Map([[`c:${CONV}`, 4]]));
    const { processor, applied, deps, advance } = setup({ streamHeads });
    await processor.push(await message(1));
    await processor.push(await message(3));
    await processor.push(await message(5));
    advance(HOLD_MS);
    await processor.checkHeld();
    expect(streamHeads).toHaveBeenCalledWith(SPACE, [`c:${CONV}`]);
    expect(deps.refetchSpace).toHaveBeenCalledWith(SPACE, [CONV]);
    expect(applied).toEqual(["m1", "m5"]);
    expect(deps.onReconciled).toHaveBeenCalledWith(SPACE);
  });

  it("says messages may be missing when reconciling fails", async () => {
    const streamHeads = vi.fn(async () => {
      throw new Error("host unreachable");
    });
    const { processor, deps, advance } = setup({ streamHeads });
    await processor.push(await message(1));
    await processor.push(await message(3));
    advance(HOLD_MS);
    await processor.checkHeld();
    expect(deps.onMissing).toHaveBeenCalledWith(SPACE, HOST);
  });

  it("binds a new direct space from a DmInvite on this person's stream", async () => {
    const { processor, applied, deps, spaces } = setup();
    spaces.clear();
    const card = {
      payload: JSON.stringify({ relays: ["https://relay-a.example"] }),
      signature: "",
    };
    await processor.push(
      await item(`u:${ME}`, 1, {
        type: "DmInvite",
        conversation_id: CONV,
        from_principal_id: "rimp1_alice",
        from_card: card,
        member_principal_ids: [ME, "rimp1_alice"],
      }),
    );
    expect(deps.ensurePinned).toHaveBeenCalledWith(HOST, ["https://relay-a.example"]);
    expect(deps.registerSpace).toHaveBeenCalledWith(SPACE, HOST);
    expect(applied).toEqual(["DmInvite"]);
  });

  it("does not take a DmInvite for someone else, nor anything else for an unknown space", async () => {
    const { processor, applied, deps, spaces } = setup();
    spaces.clear();
    await processor.push(
      await item("u:rimp1_other", 1, { type: "DmInvite", conversation_id: CONV }),
    );
    await processor.push(await message(1));
    expect(deps.registerSpace).not.toHaveBeenCalled();
    expect(applied).toEqual([]);
  });

  it("stops using a host whose identity forked", async () => {
    const forked = Object.assign(new Error("forked"), { name: "ServerForkedError" });
    const { processor, applied, deps } = setup({
      hostKeyAt: vi.fn(async () => {
        throw forked;
      }),
    });
    await processor.push(await message(1));
    expect(deps.onForked).toHaveBeenCalledWith(HOST);
    expect(applied).toEqual([]);
  });

  it("passes DM request notices on", async () => {
    const { processor, deps } = setup();
    await processor.push(JSON.stringify({ type: "DmRequestReceived" }));
    expect(deps.onDmRequest).toHaveBeenCalled();
  });

  it("verifies a held item without applying or acknowledging it", async () => {
    const { processor, applied, deps, spaces } = setup();
    spaces.clear();
    const raw = JSON.parse(
      await item(`u:${ME}`, 1, { type: "DmInvite", conversation_id: CONV, from_card: null }),
    );
    const event = await processor.verifyHeld(raw);
    expect(event?.event.type).toBe("DmInvite");
    expect(spaces.get(SPACE)).toBe(HOST);
    expect(applied).toEqual([]);
    expect(deps.ack).not.toHaveBeenCalled();
  });
});

describe("cardRelays", () => {
  it("reads relay URLs from a card without trusting it", () => {
    expect(cardRelays({ payload: '{"relays":["https://a.example",3]}' })).toEqual([
      "https://a.example",
    ]);
    expect(cardRelays(null)).toEqual([]);
    expect(cardRelays({ payload: "nope" })).toEqual([]);
  });
});
