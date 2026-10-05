/**
 * Client-side mirrors of the server's notification-settings validation (Track 1.3,
 * `rim-server/docs/messaging.md`). The server stays the authority; these only catch mistakes
 * before a round trip, with the same limits and wording.
 */

export const MAX_KEYWORDS = 20;
export const KEYWORD_MIN_LENGTH = 2;
export const KEYWORD_MAX_LENGTH = 40;

// Control characters (Unicode category Cc), which the server refuses.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

export type KeywordResult = { ok: true; keywords: string[] } | { ok: false; error: string };

/**
 * Adds the comma-separated entries of `raw` to `current` the way the server stores them:
 * trimmed, lower-cased, deduplicated, each 2 to 40 characters, at most 20 in all.
 */
export function addKeywords(current: string[], raw: string): KeywordResult {
  const next = [...current];
  for (const part of raw.split(",")) {
    const keyword = part.trim().toLowerCase();
    if (!keyword) continue;
    const length = [...keyword].length;
    if (length < KEYWORD_MIN_LENGTH || length > KEYWORD_MAX_LENGTH) {
      return {
        ok: false,
        error: `Keywords must be ${KEYWORD_MIN_LENGTH} to ${KEYWORD_MAX_LENGTH} characters long.`,
      };
    }
    if (CONTROL_CHARACTERS.test(keyword)) {
      return { ok: false, error: "Keywords must not contain control characters." };
    }
    if (next.includes(keyword)) continue;
    if (next.length >= MAX_KEYWORDS) {
      return { ok: false, error: `At most ${MAX_KEYWORDS} keywords are allowed.` };
    }
    next.push(keyword);
  }
  return { ok: true, keywords: next };
}

/** `"HH:MM"` from the server's `"HH:MM"` or `"HH:MM:SS"`. */
export function toTimeInput(value: string): string {
  return value.slice(0, 5);
}

/** The browser's IANA time zone, else UTC. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Whether the runtime knows `zone` as an IANA time zone. */
export function isValidTimeZone(zone: string): boolean {
  if (!zone.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Every IANA zone the runtime supports (with `current` always included), sorted. */
export function timeZoneOptions(current: string): string[] {
  const intl = Intl as { supportedValuesOf?: (key: "timeZone") => string[] };
  const zones =
    typeof intl.supportedValuesOf === "function" ? intl.supportedValuesOf("timeZone") : [];
  const set = new Set(zones);
  if (current) set.add(current);
  set.add("UTC");
  return [...set].sort();
}

/** One hour from `now`. */
export function inOneHour(now: Date = new Date()): Date {
  return new Date(now.getTime() + 60 * 60 * 1000);
}

/** 09:00 local time on the day after `now`. */
export function tomorrowMorning(now: Date = new Date()): Date {
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  next.setHours(9, 0, 0, 0);
  return next;
}

/** The instant a `datetime-local` value names in local time, or null when it is not valid. */
export function parseLocalDateTime(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
