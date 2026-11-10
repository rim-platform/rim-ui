import { inOneHour, tomorrowMorning } from "./rules";

/**
 * A length of a notifications pause the app offers: when it ends, and, for one that counts from
 * now, how many minutes it lasts.
 */
export interface PauseDuration {
  id: string;
  label: string;
  until: () => Date;
  minutes?: number;
}

/** The pauses the workspace menu offers, and the argument form as a number of minutes. */
export const PAUSE_DURATIONS: readonly PauseDuration[] = [
  { id: "pause-1h", label: "For 1 hour", until: () => inOneHour(), minutes: 60 },
  {
    id: "pause-8h",
    label: "For 8 hours",
    until: () => new Date(Date.now() + 8 * 60 * 60 * 1000),
    minutes: 8 * 60,
  },
  { id: "pause-tomorrow", label: "Until tomorrow morning", until: () => tomorrowMorning() },
];

/**
 * The arguments of `notifications.dnd` that pause a workspace's notifications until `until`, or
 * with `null` turn the pause off.
 */
export function pauseArguments(until: Date | null): Record<string, unknown> {
  return until ? { mode: "until", until: until.toISOString() } : { mode: "off" };
}
