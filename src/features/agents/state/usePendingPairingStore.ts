import { create } from "zustand";

import type { PendingView } from "../runtime/pairing";

interface PendingPairingState {
  /** The request waiting for the person, or `null`. */
  pending: PendingView | null;
  approve: (requestId: string) => void;
  refuse: (requestId: string) => void;
  /** Forgets every request and closes the dialog. */
  reset: () => void;
}

/** What the pairing dialog and the Agents tab need from the running pairing. */
export const usePendingPairingStore = create<PendingPairingState>(() => ({
  pending: null,
  approve: () => undefined,
  refuse: () => undefined,
  reset: () => undefined,
}));
