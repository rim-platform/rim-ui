// A plugin's audit as its settings page shows it: when each capability was
// given and revoked, and how many encrypted messages it read each day. The
// desktop keeps it in Rust (`state.rs`); the web app keeps it here, in the
// plugin's install record, with the same limits.

import type { PluginAudit, PluginGrantAction } from "./types";

/** Grant events kept per plugin; older ones are dropped first. */
export const MAX_GRANT_EVENTS = 200;
/** Days of encrypted-read counts kept per plugin. */
export const AUDIT_DAYS = 90;

export const EMPTY_AUDIT: PluginAudit = { grants: [], encrypted_reads: {} };

/** RFC 3339 to the second, in UTC, as the desktop writes it. */
function stamp(at: Date): string {
  return `${at.toISOString().slice(0, 19)}Z`;
}

export function withGrant(
  audit: PluginAudit | undefined,
  capability: string,
  action: PluginGrantAction,
  at: Date,
): PluginAudit {
  const base = audit ?? EMPTY_AUDIT;
  const grants = [...base.grants, { capability, action, at: stamp(at) }];
  return { ...base, grants: grants.slice(Math.max(0, grants.length - MAX_GRANT_EVENTS)) };
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
