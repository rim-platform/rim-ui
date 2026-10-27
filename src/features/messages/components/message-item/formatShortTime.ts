/** Format time as short bracket timestamp, e.g. "[14:32]" */
export function formatShortTime(iso: string): string {
  const date = new Date(iso);
  return `[${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}]`;
}
