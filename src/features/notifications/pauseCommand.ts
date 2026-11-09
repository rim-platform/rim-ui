/**
 * The arguments of `notifications.dnd` that pause a workspace's notifications until `until`, or
 * with `null` turn the pause off.
 */
export function pauseArguments(until: Date | null): Record<string, unknown> {
  return until ? { mode: "until", until: until.toISOString() } : { mode: "off" };
}
