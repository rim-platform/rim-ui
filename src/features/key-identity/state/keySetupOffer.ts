/**
 * The key setup step offered after signing in: which step this account has on this device, a
 * request to show it again, and the "Later" each account chose, remembered in this browser.
 */

import { create } from "zustand";

/** How long "Later" holds the step back before it is offered again. */
export const KEY_SETUP_LATER_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The step this account has here: `enroll` creates its identity on this device, `link` links
 * this device to the identity it has on another one.
 */
export type KeySetupKind = "enroll" | "link";

function laterKey(userId: string): string {
  return `rim.keySetup.later.${userId}`;
}

/** Whether the account chose "Later" less than `KEY_SETUP_LATER_MS` ago. */
export function keySetupDeferred(userId: string, now: number = Date.now()): boolean {
  try {
    const at = Number(localStorage.getItem(laterKey(userId)));
    return at > 0 && now - at < KEY_SETUP_LATER_MS;
  } catch {
    return false;
  }
}

/** Remember that the account chose "Later" at `now`. */
export function deferKeySetup(userId: string, now: number = Date.now()): void {
  try {
    localStorage.setItem(laterKey(userId), String(now));
  } catch {
    // Storage unavailable: the step is offered again at the next start.
  }
}

/** Forget the "Later" of an account removed from this device. */
export function forgetKeySetupDeferral(userId: string): void {
  try {
    localStorage.removeItem(laterKey(userId));
  } catch {
    // Storage unavailable: there is nothing kept to forget.
  }
}

interface KeySetupOfferState {
  /** The step this account has on this device, `null` when none or not known yet. */
  available: KeySetupKind | null;
  /** Something asked for the step, so it shows whatever "Later" said. */
  requested: boolean;
  setAvailable: (kind: KeySetupKind | null) => void;
  request: () => void;
  dismiss: () => void;
}

export const useKeySetupOfferStore = create<KeySetupOfferState>((set) => ({
  available: null,
  requested: false,
  setAvailable: (available) => set({ available }),
  request: () => set({ requested: true }),
  dismiss: () => set({ requested: false }),
}));

/**
 * Whether this account has a key setup step on this device, and `offer` to show it, for
 * surfaces that find the account without a key here (an unencrypted conversation, say).
 */
export function useOfferKeySetup(): { available: boolean; offer: () => void } {
  const available = useKeySetupOfferStore((s) => s.available !== null);
  const offer = useKeySetupOfferStore((s) => s.request);
  return { available, offer };
}
