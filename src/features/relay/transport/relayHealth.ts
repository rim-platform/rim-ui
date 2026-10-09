/**
 * How each host has answered through the relay: since when it has failed without a verified
 * answer in between. Kept across restarts, so a DM's home that stays unreachable for days is
 * noticed.
 */

import { logger } from "../../../core/logger";
import { allRecords, putRecord } from "../state/relayDb";
import { accountKey } from "../state/spaces";

interface HealthRecord {
  account: string;
  name: string;
  host: string;
  failingSince: number | null;
}

const failingSince = new Map<string, number | null>();

function save(host: string): void {
  const account = accountKey();
  if (!account) return;
  const record: HealthRecord = {
    account,
    name: `health:${host}`,
    host,
    failingSince: failingSince.get(host) ?? null,
  };
  void putRecord("meta", record).catch((err: unknown) =>
    logger.warn("[RIM:relay] saving host health failed:", err),
  );
}

/** Load what earlier runs recorded for this account. */
export async function loadRelayHealth(account: string): Promise<void> {
  failingSince.clear();
  for (const record of await allRecords<HealthRecord>("meta")) {
    if (record.account === account && record.name.startsWith("health:")) {
      failingSince.set(record.host, record.failingSince);
    }
  }
}

export function recordRelayFailure(host: string, now: number = Date.now()): void {
  if (failingSince.get(host)) return;
  failingSince.set(host, now);
  save(host);
}

export function recordRelaySuccess(host: string): void {
  if (!failingSince.get(host)) return;
  failingSince.set(host, null);
  save(host);
}

/** How long `host` has failed without a verified answer, in ms; 0 when it answers. */
export function failingFor(host: string, now: number = Date.now()): number {
  const since = failingSince.get(host);
  return since ? now - since : 0;
}
