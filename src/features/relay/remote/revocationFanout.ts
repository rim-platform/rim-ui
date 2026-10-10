/**
 * After this app revokes a device, the relay sends the revocation to every host holding the
 * person, and each answers a signed acknowledgement. The app follows it
 * (`deviceRevocationStatus`, refreshed on `RevocationAcked`), checks every acknowledgement
 * against the host's pinned key and the revocation's hash, and 2 minutes in sends the
 * revocation directly to each host still without a verified one (`applyRemoteRevocation`,
 * which needs no session). A host it cannot reach is named with how long the device may keep
 * access there: until its delegation runs out, 24 hours after the revocation at most.
 */

import {
  graphqlErrorCode,
  graphqlErrorMessage,
  RATE_LIMITED,
  retryAfterSeconds,
} from "../../../core/graphql/errors";
import { RevocationFanoutStatus } from "../../../core/graphql/generated/schema-types";
import type { Statement } from "../../key-identity/browser/statements";
import type { RevocationFanoutView } from "../api/relayApi";
import type { RelayCrypto } from "../crypto/relayCrypto";
import { MAX_DELEGATION_MS } from "../crypto/serverStatements";

/** How long the relay's fan-out runs before the app sends the revocation itself. */
export const DIRECT_AFTER_MS = 2 * 60 * 1000;

/** Where one host stands with the revocation, as this app checked it. */
export interface HostRevocation {
  host: string;
  /** `confirmed`: a verified acknowledgement; `waiting`: none yet; `failed`: none will come. */
  state: "confirmed" | "waiting" | "failed";
  /** How the confirmation came: through the relay or sent directly. */
  via: "relay" | "direct" | null;
  appliedAt: string | null;
  /** Why it is not confirmed, when that is known. */
  problem: string | null;
}

/** What checking acknowledgements needs. */
export interface AckDeps {
  crypto: Pick<RelayCrypto, "revocationAckKeySeq" | "verifyRevocationAck">;
  hostKeyAt(host: string, keySeq: number): Promise<string>;
}

/** Verify a host's acknowledgement of `revocation`; the time it applied it, or a reason. */
export async function checkAck(
  host: string,
  ack: Statement,
  revocation: Statement,
  deps: AckDeps,
): Promise<{ appliedAt: string } | { problem: string }> {
  try {
    const keySeq = await deps.crypto.revocationAckKeySeq(ack);
    const key = await deps.hostKeyAt(host, keySeq);
    const entry = await deps.crypto.verifyRevocationAck(ack, key, {
      host,
      revocationPayload: revocation.payload,
    });
    return { appliedAt: entry.appliedAt };
  } catch (err) {
    return { problem: err instanceof Error ? err.message : String(err) };
  }
}

/** Each host's state from the relay's fan-out rows, acknowledgements checked. */
export async function readFanout(
  revocation: Statement,
  rows: RevocationFanoutView[],
  deps: AckDeps,
): Promise<HostRevocation[]> {
  const out: HostRevocation[] = [];
  for (const row of rows) {
    if (row.ack) {
      const checked = await checkAck(row.hostServerId, row.ack, revocation, deps);
      if ("appliedAt" in checked) {
        out.push({
          host: row.hostServerId,
          state: "confirmed",
          via: "relay",
          appliedAt: checked.appliedAt,
          problem: null,
        });
        continue;
      }
      out.push({
        host: row.hostServerId,
        state: "waiting",
        via: null,
        appliedAt: null,
        problem: checked.problem,
      });
      continue;
    }
    out.push({
      host: row.hostServerId,
      state: row.status === RevocationFanoutStatus.GAVE_UP ? "failed" : "waiting",
      via: null,
      appliedAt: null,
      problem:
        row.status === RevocationFanoutStatus.GAVE_UP ? "The relay gave up reaching it." : null,
    });
  }
  return out;
}

/** Whether it is time to send the revocation directly. */
export function directDue(startedAt: number, now: number): boolean {
  return now - startedAt >= DIRECT_AFTER_MS;
}

/** Why sending the revocation to a host directly failed, in words. */
export function directProblem(err: unknown): string {
  if (graphqlErrorCode(err) === RATE_LIMITED) {
    const seconds = retryAfterSeconds(err);
    const wait = seconds === undefined ? "later" : `in ${Math.max(1, Math.ceil(seconds / 60))} min`;
    return `it refused more removals from this address for now; it accepts them again ${wait}`;
  }
  return graphqlErrorMessage(err, String(err));
}

/**
 * Send the revocation directly to every host not confirmed yet and check each answer.
 * `apply` sends it to one host and returns its acknowledgement.
 */
export async function sendDirectly(
  revocation: Statement,
  hosts: HostRevocation[],
  apply: (host: string, revocation: Statement) => Promise<Statement>,
  deps: AckDeps,
): Promise<HostRevocation[]> {
  const out: HostRevocation[] = [];
  for (const entry of hosts) {
    if (entry.state === "confirmed") {
      out.push(entry);
      continue;
    }
    try {
      const ack = await apply(entry.host, revocation);
      const checked = await checkAck(entry.host, ack, revocation, deps);
      out.push(
        "appliedAt" in checked
          ? {
              host: entry.host,
              state: "confirmed",
              via: "direct",
              appliedAt: checked.appliedAt,
              problem: null,
            }
          : {
              host: entry.host,
              state: "failed",
              via: null,
              appliedAt: null,
              problem: checked.problem,
            },
      );
    } catch (err) {
      out.push({
        host: entry.host,
        state: "failed",
        via: null,
        appliedAt: null,
        problem: directProblem(err),
      });
    }
  }
  return out;
}

/**
 * Until when the revoked device may keep access on a host that has not confirmed: the
 * subscription's expiry when the relay knows one, never past 24 hours after the revocation.
 */
export function accessUntil(revokedAt: number, subscriptionExpiry: string | null): number {
  const bound = revokedAt + MAX_DELEGATION_MS;
  const expiry = subscriptionExpiry ? Date.parse(subscriptionExpiry) : Number.NaN;
  return Number.isNaN(expiry) ? bound : Math.min(bound, expiry);
}

/** The sentence naming a host that has not confirmed. */
export function unconfirmedText(host: string, workspace: string, until: string): string {
  return `${host} has not confirmed; the device keeps access to ${workspace} until ${until}`;
}
