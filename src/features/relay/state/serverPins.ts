/**
 * Servers this app pinned on first use: the home of a DM someone else started, a contact's
 * relay. A pin is the server's key log as first verified here; a later log must extend it
 * along valid rotations. A fork stops this app using the server.
 *
 * After a `signer: server` rotation the key before the head still verifies for 24 hours from
 * when this app accepted the rotation; after a `signer: recovery` rotation it never does, and a
 * first pin gives no grace.
 */

import { comparePin, type ServerHead } from "../crypto/serverStatements";
import { relayCrypto } from "../crypto/relayCrypto";
import { fetchRemoteServer } from "../api/relayApi";
import { getRecord, putRecord, type ServerPin } from "./relayDb";
import { useRelayStore } from "./useRelayStore";

const GRACE_MS = 24 * 60 * 60 * 1000;
const REFETCH_MS = 60 * 1000;

/** The server's identity changed in a way RIM cannot verify; the app stopped using it. */
export class ServerForkedError extends Error {
  readonly serverId: string;

  constructor(serverId: string) {
    super("This server's identity changed in a way RIM cannot verify");
    this.name = "ServerForkedError";
    this.serverId = serverId;
  }
}

/** Pins read or written in this run, by server id. */
const cache = new Map<string, ServerPin>();
/** When each origin was last fetched, to fetch at most once a minute. */
const lastFetch = new Map<string, number>();

/** Forget the pins read in this run (tests, sign-out). */
export function resetPinCache(): void {
  cache.clear();
  lastFetch.clear();
}

async function loadPin(serverId: string): Promise<ServerPin | null> {
  const cached = cache.get(serverId);
  if (cached) return cached;
  const stored = await getRecord<ServerPin>("servers", serverId);
  if (stored) {
    cache.set(serverId, stored);
    useRelayStore.getState().setOrigin(serverId, stored.origin);
  }
  return stored;
}

async function savePin(pin: ServerPin): Promise<void> {
  cache.set(pin.serverId, pin);
  useRelayStore.getState().setOrigin(pin.serverId, pin.origin);
  await putRecord("servers", pin);
}

function fork(pin: ServerPin): never {
  useRelayStore.getState().markForked(pin.serverId);
  throw new ServerForkedError(pin.serverId);
}

/** A new pin, or what `head` makes of the existing one. Pure, for tests. */
export function nextPin(
  existing: ServerPin | null,
  fetched: { origin: string; log: ServerPin["log"]; head: ServerHead; descriptorVersion: number },
  now: number,
): ServerPin {
  const { head } = fetched;
  const fresh = (previousKeyUntil: number | null): ServerPin => ({
    serverId: head.serverId,
    origin: fetched.origin,
    log: fetched.log,
    hashes: head.hashes,
    keys: head.keys,
    signers: head.signers,
    previousKeyUntil,
    descriptorVersion: fetched.descriptorVersion,
    status: "active",
    pinnedAt: existing?.pinnedAt ?? now,
    fetchedAt: now,
  });
  if (!existing) return fresh(null);
  if (existing.status === "forked") return existing;
  switch (comparePin(existing.hashes, head)) {
    case "equal":
      return {
        ...existing,
        descriptorVersion: Math.max(existing.descriptorVersion, fetched.descriptorVersion),
        fetchedAt: now,
      };
    case "extends":
      return fresh(head.signers[head.seq] === "server" ? now + GRACE_MS : null);
    case "prefix":
      return { ...existing, fetchedAt: now };
    case "fork":
      return { ...existing, status: "forked", fetchedAt: now };
  }
}

/**
 * Fetch the server at `origin` through the relay, verify its discovery document and pin it,
 * or check it against the pin. With `expectedServerId`, a server with another id is refused.
 * Throws `ServerForkedError` when the log does not extend the pin.
 */
export async function pinServer(origin: string, expectedServerId?: string): Promise<ServerPin> {
  const now = Date.now();
  const last = lastFetch.get(origin);
  if (last !== undefined && now - last < REFETCH_MS && expectedServerId) {
    const pinned = await loadPin(expectedServerId);
    if (pinned) return pinned.status === "forked" ? fork(pinned) : pinned;
  }
  lastFetch.set(origin, now);
  const remote = await fetchRemoteServer(origin);
  const verified = await relayCrypto().verifyDiscovery(remote.discovery, origin);
  if (verified.head.serverId !== remote.serverId) {
    throw new Error("the relay named another server than the one it fetched");
  }
  if (expectedServerId && verified.head.serverId !== expectedServerId) {
    throw new Error(`${origin} is another server than the one expected`);
  }
  const existing = await loadPin(verified.head.serverId);
  const pin = nextPin(
    existing,
    {
      origin,
      log: verified.log,
      head: verified.head,
      descriptorVersion: verified.descriptor.version,
    },
    now,
  );
  if (pin !== existing) await savePin(pin);
  if (pin.status === "forked") fork(pin);
  return pin;
}

/**
 * Make sure `serverId` is pinned: an existing pin, or the first of `origins` that serves that
 * server. Trust on first use: any of them may answer, as the id itself is self-certifying.
 */
export async function ensurePinned(
  serverId: string,
  origins: readonly string[],
): Promise<ServerPin> {
  const existing = await loadPin(serverId);
  if (existing) return existing.status === "forked" ? fork(existing) : existing;
  let lastError: unknown = new Error(`no relay URL to reach ${serverId}`);
  for (const origin of origins) {
    try {
      return await pinServer(origin, serverId);
    } catch (err) {
      if (err instanceof ServerForkedError) throw err;
      lastError = err;
    }
  }
  throw lastError;
}

/** The key of `pin` that may sign at `keySeq` now, or `null`. Pure, for tests. */
export function keyAt(pin: ServerPin, keySeq: number, now: number): string | null {
  const headSeq = pin.keys.length - 1;
  if (keySeq === headSeq) return pin.keys[headSeq];
  const graced =
    keySeq === headSeq - 1 &&
    pin.signers[headSeq] === "server" &&
    pin.previousKeyUntil !== null &&
    now < pin.previousKeyUntil;
  return graced ? pin.keys[keySeq] : null;
}

/**
 * The host key a statement signed at `keySeq` must verify under. A seq above the pin refetches
 * the server once and accepts only an extension of the pin.
 */
export async function hostKeyAt(serverId: string, keySeq: number): Promise<string> {
  let pin = await loadPin(serverId);
  if (!pin) throw new Error(`${serverId} is not pinned`);
  if (pin.status === "forked") fork(pin);
  if (keySeq > pin.keys.length - 1) pin = await pinServer(pin.origin, serverId);
  const key = keyAt(pin, keySeq, Date.now());
  if (!key) throw new Error(`signed by a key of ${serverId} this app does not accept`);
  return key;
}

/** Whether this app stopped using `serverId` because its identity forked. */
export async function isForked(serverId: string): Promise<boolean> {
  return (await loadPin(serverId))?.status === "forked";
}

/** Read the pins of `serverIds` at start: their origins for the UI, and which forked. */
export async function loadPins(serverIds: readonly string[]): Promise<void> {
  for (const serverId of serverIds) {
    const pin = await loadPin(serverId).catch(() => null);
    if (pin?.status === "forked") useRelayStore.getState().markForked(serverId);
  }
}
