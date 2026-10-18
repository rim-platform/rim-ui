/** Whether a timeout end (`ServerMember.timeoutUntil`) is still in the future. */
export function isTimeoutActive(
  until: string | null | undefined,
  now: number = Date.now(),
): until is string {
  return Boolean(until) && Date.parse(until as string) > now;
}

/** ISO timestamp `seconds` from now. */
export function isoInSeconds(seconds: number, now: number = Date.now()): string {
  return new Date(now + seconds * 1000).toISOString();
}

/**
 * Converts a `<input type="datetime-local">` value (local wall time) to an ISO timestamp, or
 * `null` when empty, unparsable or not in the future.
 */
export function futureIsoFromLocalInput(value: string, now: number = Date.now()): string | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms) || ms <= now) return null;
  return new Date(ms).toISOString();
}

export interface DurationPreset {
  id: string;
  label: string;
  seconds: number;
}

/** The timeout lengths offered by the member menu and the timeout dialog. */
export const TIMEOUT_PRESETS: DurationPreset[] = [
  { id: "10m", label: "10 minutes", seconds: 10 * 60 },
  { id: "1h", label: "1 hour", seconds: 60 * 60 },
  { id: "1d", label: "1 day", seconds: 24 * 60 * 60 },
  { id: "1w", label: "1 week", seconds: 7 * 24 * 60 * 60 },
];

export const BAN_EXPIRY_PRESETS: DurationPreset[] = [
  { id: "1d", label: "1 day", seconds: 24 * 60 * 60 },
  { id: "7d", label: "7 days", seconds: 7 * 24 * 60 * 60 },
  { id: "30d", label: "30 days", seconds: 30 * 24 * 60 * 60 },
];
