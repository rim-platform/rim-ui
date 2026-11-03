/** How long a block made on this device speaks for itself: its own toast says what it hid. */
const BLOCKED_HERE_MS = 10_000;
/** Principals blocked on this device, with when. */
const blockedHere = new Map<string, number>();

/** Records that this device just blocked `principalId`, so closing what it hid says nothing more. */
export function noteBlockedHere(principalId: string): void {
  blockedHere.set(principalId, Date.now());
}

/** Whether this device blocked `principalId` within the last few seconds. */
export function blockedHereJustNow(principalId: string): boolean {
  return Date.now() - (blockedHere.get(principalId) ?? 0) <= BLOCKED_HERE_MS;
}
