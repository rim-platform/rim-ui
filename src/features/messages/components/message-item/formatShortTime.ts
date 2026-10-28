import { timeOfDayOptions } from "../../../../shared/utils/formatTime";

/** Format time as short bracket timestamp, e.g. "[14:32]" */
export function formatShortTime(iso: string): string {
  const date = new Date(iso);
  return `[${date.toLocaleTimeString([], timeOfDayOptions())}]`;
}
