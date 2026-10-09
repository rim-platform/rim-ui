/**
 * The `seq` of each device request: above every one this device used with the host, from
 * `max(previous + 1, Unix time in µs)`, written to storage before the request is signed so a
 * crash cannot reuse it. Requests to one host take numbers one at a time.
 */

import { MAX_REQUEST_SEQ } from "../crypto/serverStatements";
import { updateRecord } from "../state/relayDb";

interface SeqRecord {
  deviceId: string;
  host: string;
  seq: number;
}

const chains = new Map<string, Promise<unknown>>();

/** Unix time in microseconds. */
export function nowMicros(now: number = Date.now()): number {
  return Math.floor(now) * 1000;
}

/** The next `seq` after `previous`, at least `floor`. Pure, for tests. */
export function seqAfter(previous: number | null, now: number, floor = 0): number {
  const next = Math.max((previous ?? 0) + 1, nowMicros(now), floor);
  if (next > MAX_REQUEST_SEQ) throw new Error("the device request counter is exhausted");
  return next;
}

/**
 * Take the next `seq` for (`deviceId`, `host`) and store it. `floor` moves the counter above
 * a `highestSeq` the host reported.
 */
export function takeSeq(deviceId: string, host: string, floor = 0): Promise<number> {
  const key = `${deviceId}|${host}`;
  const run = (chains.get(key) ?? Promise.resolve()).then(async () => {
    const stored = await updateRecord<SeqRecord>("requestSeq", [deviceId, host], (current) => ({
      deviceId,
      host,
      seq: seqAfter(current?.seq ?? null, Date.now(), floor),
    }));
    if (!stored) throw new Error("the device request counter was not stored");
    return stored.seq;
  });
  chains.set(
    key,
    run.catch(() => undefined),
  );
  return run;
}
