import { useClockFormatStore } from "../state/useClockFormatStore";

/** Intl options that apply the device's clock choice; empty when the browser's language decides. */
export function hourCycleOptions(): Intl.DateTimeFormatOptions {
  const { clockFormat } = useClockFormatStore.getState();
  if (clockFormat === "12h") return { hour12: true };
  if (clockFormat === "24h") return { hour12: false };
  return {};
}

/** Options for a bare time of day: 24-hour times always have two-digit hours. */
export function timeOfDayOptions(): Intl.DateTimeFormatOptions {
  const cycle = hourCycleOptions();
  return { hour: cycle.hour12 === false ? "2-digit" : "numeric", minute: "2-digit", ...cycle };
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) {
    return date.toLocaleTimeString([], timeOfDayOptions());
  }
  return (
    date.toLocaleDateString([], { month: "short", day: "numeric" }) +
    " " +
    date.toLocaleTimeString([], timeOfDayOptions())
  );
}

/** Human-friendly relative time string (e.g. "3m ago", "2d ago"). */
export function formatRelativeTime(sentAt: string): string {
  const now = Date.now();
  const then = new Date(sentAt).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(sentAt).toLocaleDateString();
}

/** A full date and time for a tooltip, e.g. "Oct 27, 2026, 2:05 PM"; "—" when unreadable. */
export function formatEditedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
    ...hourCycleOptions(),
  });
}
