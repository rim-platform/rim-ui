import type { MemberMessageCounts, MessageTally } from "../../core/graphql/generated/schema-types";

/**
 * How far back a person's messages are deleted: `none` deletes nothing, `all` everything; the
 * other ids match the server command's `window` values.
 */
export type DeletePeriod = "none" | "1h" | "24h" | "7d" | "all";

/** The periods a moderator picks from, with their length in seconds (null for everything). */
export const DELETE_PERIODS: {
  id: Exclude<DeletePeriod, "none">;
  label: string;
  seconds: number | null;
}[] = [
  { id: "1h", label: "Last hour", seconds: 60 * 60 },
  { id: "24h", label: "Last 24 hours", seconds: 24 * 60 * 60 },
  { id: "7d", label: "Last 7 days", seconds: 7 * 24 * 60 * 60 },
  { id: "all", label: "Everything", seconds: null },
];

/** The label of the `none` period. */
export const DONT_DELETE_LABEL = "Don't delete";

/**
 * The start of `period` as an ISO time, `now` minus its length.
 *
 * @returns null for `all` (no bound) and for `none`.
 */
export function periodSince(period: DeletePeriod, now = Date.now()): string | null {
  const seconds = DELETE_PERIODS.find((p) => p.id === period)?.seconds ?? null;
  return seconds === null ? null : new Date(now - seconds * 1000).toISOString();
}

/** `n` and `noun`, with an "s" unless `n` is 1: "1 message", "3 channels". */
export function countOf(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** A tally in words, for example "38 messages in 3 channels". */
export function tallyText(t: MessageTally): string {
  return `${countOf(t.messages, "message")} in ${countOf(t.channels, "channel")}`;
}

/**
 * How many messages a delete with these counts removes.
 *
 * @param includePrivate Whether the private channels the viewer is not in are included.
 */
export function messagesToDelete(c: MemberMessageCounts, includePrivate: boolean): number {
  return c.readable.messages + (includePrivate ? c.unjoinedPrivate.messages : 0);
}

/** What a finished deletion says: how many went, and whether more remain. */
export function deletedText(r: { deleted: number; hasMore: boolean }): string {
  const text = `Deleted ${countOf(r.deleted, "message")}`;
  return r.hasMore ? `${text}; more remain, run Delete messages again` : text;
}
