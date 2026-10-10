/**
 * Relay items signed by the known-answer host key, and a stream processor around them, for
 * tests of what reaches the app through a relay or directly.
 */

import { vi } from "vitest";

import vectors from "../../protocol/relay-vectors.json";
import { sign } from "../features/key-identity/browser/statements";
import type { RelayItemView } from "../features/relay/api/relayApi";
import { browserRelayCrypto } from "../features/relay/crypto/relayCrypto";
import { RELAY_CONTEXT } from "../features/relay/crypto/serverStatements";
import { RelayStreamProcessor, type RelayStreamDeps } from "../features/relay/stream/relayStream";
import { keyFromSeed } from "./ed25519";

export const HOST = vectors.host.serverId;
export const HOST_KEY = vectors.host.serverKey;
export const SPACE = "0199d1a0-0000-7000-8000-000000000002";
export const CONV = "0199d1a0-0000-7000-8000-000000000003";
export const ME = "rimp1_me";

let nextId = 1000;

/** A relay item carrying a message event at `seq` of the conversation's stream. */
export async function messageItem(
  seq: number,
  id: string = String(nextId++),
): Promise<RelayItemView> {
  const payload = JSON.stringify({
    v: 2,
    type: "host-event",
    host: HOST,
    keySeq: 0,
    workspaceId: SPACE,
    stream: `c:${CONV}`,
    seq,
    event: {
      type: "MessageDeleted",
      workspace_id: SPACE,
      conversation_id: CONV,
      message_id: `m${seq}`,
    },
    issuedAt: "2026-10-09T00:00:00Z",
  });
  const key = await keyFromSeed(vectors.host.seed);
  const envelope = await sign(key.privateKey, RELAY_CONTEXT.hostEvent, payload);
  return { id, hostServerId: HOST, workspaceId: SPACE, envelope };
}

/** The `relayStream` message of an item. */
export function asMessage(item: RelayItemView): string {
  return JSON.stringify({ type: "RelayItem", ...item });
}

/** A processor for `ME` with `SPACE` bound to `HOST`, recording what it applies. */
export function processorFor(
  stored: Map<string, number>,
  applied: string[],
  overrides: Partial<RelayStreamDeps> = {},
): RelayStreamProcessor {
  const deps: RelayStreamDeps = {
    crypto: browserRelayCrypto,
    principalId: ME,
    hostOf: (id) => (id === SPACE ? HOST : null),
    registerSpace: vi.fn(async () => true),
    ensurePinned: vi.fn(async () => undefined),
    hostKeyAt: vi.fn(async () => HOST_KEY),
    loadLast: async (key) => stored.get(key) ?? null,
    saveLast: async (key, seq) => {
      stored.set(key, seq);
    },
    streamHeads: vi.fn(async () => new Map<string, number>()),
    refetchSpace: vi.fn(async () => undefined),
    apply: (event) => {
      applied.push(String((event as { message_id?: string }).message_id ?? event.type));
    },
    ack: vi.fn(async () => undefined),
    onMissing: vi.fn(),
    onReconciled: vi.fn(),
    onDmRequest: vi.fn(),
    onForked: vi.fn(),
    now: () => 0,
    ...overrides,
  };
  return new RelayStreamProcessor(deps);
}
