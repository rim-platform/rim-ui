/**
 * Delegations: this device lets its relay carry one workspace's traffic with that workspace's
 * host for at most 24 hours. A new one is signed for each workspace elsewhere when the current
 * one has under 6 hours left, while the app runs, and presented with `renewDelegations`. One
 * that lapsed (every device was away) is renewed on return and the space catches up from its
 * change feed and stream heads.
 */

import { logger } from "../../../core/logger";
import { b64 } from "../../key-identity/browser/bytes";
import { issuedAtNow, MAX_DELEGATION_MS } from "../crypto/serverStatements";
import type { Statement } from "../../key-identity/browser/statements";
import type { RemoteSubscriptionView } from "../api/relayApi";
import type { DelegationFields } from "../crypto/relayCrypto";
import type { DelegationRecord } from "../state/relayDb";
import type { RelaySelf } from "./relaySelf";

/** How long a new delegation runs. */
export const DELEGATION_MS = MAX_DELEGATION_MS;
/** A delegation with less than this left is renewed. */
export const RENEW_BEFORE_MS = 6 * 60 * 60 * 1000;
/** The most delegations one `renewDelegations` call carries. */
export const RENEW_BATCH = 64;

/** The fields of a fresh delegation for `workspaceId` on `host` through `relay`. */
export function delegationFields(
  relay: RelaySelf,
  host: string,
  workspaceId: string,
  now: number,
  nonce: Uint8Array = crypto.getRandomValues(new Uint8Array(16)),
): DelegationFields {
  const issued = Math.floor(now / 1000) * 1000;
  return {
    relay: relay.serverId,
    relayKeyHash: relay.keyHash,
    host,
    workspaceId,
    nonce: b64(nonce),
    issuedAt: issuedAtNow(issued),
    expiresAt: issuedAtNow(issued + DELEGATION_MS),
  };
}

/** Whether a workspace needs a new delegation: none yet, one for another relay, or one ending. */
export function needsRenewal(record: DelegationRecord | null, relay: string, now: number): boolean {
  return !record || record.relay !== relay || record.expiresAt - now < RENEW_BEFORE_MS;
}

/** Why a host refused a delegation, by the reason its answer names. */
const REFUSALS: Record<string, string> = {
  not_member: "this account is no longer a member there",
  banned: "this account is banned there",
  expired: "the delegation had expired",
  revoked_device: "this device was removed from the account",
  unknown_device: "the server does not know this device",
  relay_key: "the server no longer accepts this relay's key",
  wrong_relay: "the delegation names another relay",
  wrong_host: "the delegation names another server",
  bad_signature: "the delegation's signature did not verify",
  invalid_delegation: "the delegation could not be read",
  limited: "too many delegations at once; it is tried again later",
  rate_limited: "too many requests; it is tried again later",
  upstream_unavailable: "the server could not be reached; it is tried again later",
};

/** The sentence saying why the last renewal for a workspace was refused. */
export function refusalText(reason: string | null): string {
  const why = reason ? (REFUSALS[reason] ?? reason) : "no reason given";
  return `The last renewal was refused: ${why}.`;
}

/** A workspace elsewhere that this account uses. */
export interface RemoteWorkspace {
  workspaceId: string;
  host: string;
}

/** What renewing needs from the rest of the app; injected so it can be tested alone. */
export interface RenewDeps {
  relay(): Promise<RelaySelf>;
  load(workspaceId: string): Promise<DelegationRecord | null>;
  save(record: DelegationRecord): Promise<void>;
  sign(fields: DelegationFields): Promise<Statement>;
  renew(delegations: Statement[]): Promise<RemoteSubscriptionView[]>;
  account: string;
  now(): number;
}

/** What one round of renewing did. */
export interface RenewOutcome {
  renewed: RemoteSubscriptionView[];
  /** Workspaces whose delegation had run out before this round: they must catch up. */
  lapsed: string[];
}

/**
 * Sign and present new delegations for every workspace in `workspaces` that needs one
 * (`force` renews them all, after a relay switch or a direct connection).
 */
export async function renewDue(
  workspaces: RemoteWorkspace[],
  deps: RenewDeps,
  force = false,
): Promise<RenewOutcome> {
  const now = deps.now();
  const relay = await deps.relay();
  const due: {
    space: RemoteWorkspace;
    lapsed: boolean;
    statement: Statement;
    fields: DelegationFields;
  }[] = [];
  for (const space of workspaces) {
    const record = await deps.load(space.workspaceId);
    if (!force && !needsRenewal(record, relay.serverId, now)) continue;
    const fields = delegationFields(relay, space.host, space.workspaceId, now);
    due.push({
      space,
      lapsed: record !== null && record.expiresAt <= now,
      statement: await deps.sign(fields),
      fields,
    });
  }
  const renewed: RemoteSubscriptionView[] = [];
  for (let i = 0; i < due.length; i += RENEW_BATCH) {
    const batch = due.slice(i, i + RENEW_BATCH);
    const answers = await deps.renew(batch.map((d) => d.statement));
    renewed.push(...answers);
    for (const [at, entry] of batch.entries()) {
      const answer = answers[at];
      if (answer && answer.status !== "active") {
        logger.warn(
          `[RIM:relay] ${entry.space.host} refused the delegation for ${entry.space.workspaceId}: ${answer.reason ?? answer.status}`,
        );
        continue;
      }
      await deps.save({
        account: deps.account,
        workspaceId: entry.space.workspaceId,
        host: entry.space.host,
        relay: relay.serverId,
        issuedAt: Date.parse(entry.fields.issuedAt),
        expiresAt: Date.parse(entry.fields.expiresAt),
        statement: entry.statement,
      });
    }
  }
  return { renewed, lapsed: due.filter((d) => d.lapsed).map((d) => d.space.workspaceId) };
}
