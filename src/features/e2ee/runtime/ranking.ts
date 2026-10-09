/**
 * Which group device commits pending membership changes, and when: every device not pending
 * removal sorts the eligible device ids (lowercase UUID text) and takes its position as its
 * rank; it waits `min(rank, 8) × 15 s` plus up to 3 s of jitter before committing. A member's
 * own other device ranks first when one of their devices is being added.
 */

const STEP_MS = 15_000;
const MAX_RANK = 8;
export const MAX_JITTER_MS = 3_000;

/** `me`'s rank among the group devices not pending removal, or `null` when it may not commit. */
export function commitRank(
  groupDevices: string[],
  pendingRemoves: string[],
  first: string | null,
  me: string,
): number | null {
  const removed = new Set(pendingRemoves.map((d) => d.toLowerCase()));
  const eligible = [...new Set(groupDevices.map((d) => d.toLowerCase()))]
    .filter((d) => !removed.has(d))
    .sort();
  const lead = first?.toLowerCase();
  if (lead && eligible.includes(lead)) {
    eligible.splice(eligible.indexOf(lead), 1);
    eligible.unshift(lead);
  }
  const position = eligible.indexOf(me.toLowerCase());
  return position < 0 ? null : position;
}

/** How long a device of `rank` waits before refetching the group and committing. */
export function commitDelayMs(rank: number, jitterMs: number = Math.random() * MAX_JITTER_MS) {
  return STEP_MS * Math.min(rank, MAX_RANK) + Math.min(Math.max(jitterMs, 0), MAX_JITTER_MS);
}
