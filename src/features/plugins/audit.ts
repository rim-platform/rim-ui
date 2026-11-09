// A plugin's audit as its settings page shows it: when each capability was
// given and revoked, and how many encrypted messages it read each day. The
// desktop keeps it in Rust (`state.rs`); the web app keeps it here, in the
// plugin's install record, with the same limits.

import type { PluginAudit, PluginCommandRunOutcome, PluginGrantAction } from "./types";

/** Grant events kept per plugin; older ones are dropped first. */
export const MAX_GRANT_EVENTS = 200;
/** Days of encrypted-read counts kept per plugin. */
export const AUDIT_DAYS = 90;
/** Command runs kept per plugin; older ones are dropped first. */
export const MAX_COMMAND_RUNS = 200;

export const EMPTY_AUDIT: PluginAudit = { grants: [], encrypted_reads: {} };

/** RFC 3339 to the second, in UTC, as the desktop writes it. */
function stamp(at: Date): string {
  return `${at.toISOString().slice(0, 19)}Z`;
}

/**
 * `audit` with a grant event added and the oldest dropped past {@link MAX_GRANT_EVENTS}.
 *
 * @param capability - The capability's name, or the command's id for a command grant.
 * @param kind - Whether a capability or a command was given or taken back.
 */
export function withGrant(
  audit: PluginAudit | undefined,
  capability: string,
  action: PluginGrantAction,
  at: Date,
  kind: "capability" | "command" = "capability",
): PluginAudit {
  const base = audit ?? EMPTY_AUDIT;
  const event = {
    capability,
    ...(kind === "command" ? { kind } : {}),
    action,
    at: stamp(at),
  };
  const grants = [...base.grants, event];
  return { ...base, grants: grants.slice(Math.max(0, grants.length - MAX_GRANT_EVENTS)) };
}

/**
 * `audit` with a command run added and the oldest dropped past {@link MAX_COMMAND_RUNS}.
 *
 * @param code - Why a refused run was refused.
 */
export function withCommandRun(
  audit: PluginAudit | undefined,
  commandId: string,
  outcome: PluginCommandRunOutcome,
  code: string | undefined,
  at: Date,
): PluginAudit {
  const base = audit ?? EMPTY_AUDIT;
  const run = { command_id: commandId, outcome, ...(code ? { code } : {}), at: stamp(at) };
  const runs = [...(base.command_runs ?? []), run];
  return { ...base, command_runs: runs.slice(Math.max(0, runs.length - MAX_COMMAND_RUNS)) };
}

export function withEncryptedReads(
  audit: PluginAudit | undefined,
  count: number,
  at: Date,
): PluginAudit {
  const base = audit ?? EMPTY_AUDIT;
  if (count <= 0) return base;
  const day = at.toISOString().slice(0, 10);
  const reads = { ...base.encrypted_reads, [day]: (base.encrypted_reads[day] ?? 0) + count };
  const days = Object.keys(reads).sort();
  for (const old of days.slice(0, Math.max(0, days.length - AUDIT_DAYS))) delete reads[old];
  return { ...base, encrypted_reads: reads };
}
