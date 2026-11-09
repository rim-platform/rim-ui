/** Slow-mode choices offered in the header menu, in seconds (`0` = off). */
export const SLOW_MODE_OPTIONS: { seconds: number; label: string }[] = [
  { seconds: 0, label: "Off" },
  { seconds: 5, label: "5 seconds" },
  { seconds: 10, label: "10 seconds" },
  { seconds: 30, label: "30 seconds" },
  { seconds: 60, label: "1 minute" },
  { seconds: 300, label: "5 minutes" },
  { seconds: 900, label: "15 minutes" },
  { seconds: 3600, label: "1 hour" },
];

/** Short label for an interval, e.g. `30 s`, `5 min`, `1 h`. */
export function formatSlowModeInterval(seconds: number): string {
  if (seconds % 3600 === 0) return `${seconds / 3600} h`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds} s`;
}

/** The message for a send refused by slow mode (`RATE_LIMITED` with `retryAfterSeconds`). */
export function slowModeWaitMessage(retryAfterSeconds: number): string {
  return `Slow mode: wait ${retryAfterSeconds} s`;
}
