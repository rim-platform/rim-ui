/** The instant of an ISO 8601 time: its millisecond, and its fraction of a second to nine digits. */
function instantOf(iso: string): { ms: number; fraction: string } {
  const digits = /\.(\d+)/.exec(iso)?.[1] ?? "";
  return { ms: Date.parse(iso), fraction: digits.padEnd(9, "0") };
}

/**
 * Whether the ISO 8601 time `a` is later than `b`, to the server's microsecond and whichever way
 * each one writes its offset. `Date.parse` alone stops at the millisecond, where a read marker
 * set just before a message would compare equal to that message.
 */
export function isAfter(a: string, b: string): boolean {
  const first = instantOf(a);
  const second = instantOf(b);
  if (first.ms !== second.ms) return first.ms > second.ms;
  return first.fraction > second.fraction;
}
