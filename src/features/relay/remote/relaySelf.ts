/**
 * This app's relay as a delegation names it: its server id and the hash of its current key,
 * read from its own discovery document (fetched directly, checked like any server's and
 * pinned under the origin the relay is known by).
 */

import { keyHash } from "../crypto/serverStatements";
import { readOwnDiscovery } from "../state/serverOrigin";
import { pinDiscovery } from "../state/serverPins";
import { useRelayStore } from "../state/useRelayStore";

export interface RelaySelf {
  serverId: string;
  keyHash: string;
}

const TTL_MS = 10 * 60 * 1000;
let cached: { value: RelaySelf; at: number } | null = null;

/** Forget the relay's key read in this run (tests, sign-out). */
export function resetRelaySelf(): void {
  cached = null;
}

export async function relaySelf(now: number = Date.now()): Promise<RelaySelf> {
  const info = useRelayStore.getState().info;
  if (!info) throw new Error("this server does not run as a relay");
  if (cached && cached.value.serverId === info.serverId && now - cached.at < TTL_MS) {
    return cached.value;
  }
  const { origin, document } = await readOwnDiscovery();
  const pin = await pinDiscovery(document, origin, info.serverId, now);
  const value = { serverId: pin.serverId, keyHash: await keyHash(pin.keys[pin.keys.length - 1]) };
  cached = { value, at: now };
  return value;
}
