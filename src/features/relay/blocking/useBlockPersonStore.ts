import { create } from "zustand";

import type { BlockTarget } from "./blockPerson";

interface BlockPersonState {
  target: BlockTarget | null;
  ask: (target: BlockTarget) => void;
  close: () => void;
}

/** The person a Block… action asks about, until the confirmation closes. */
export const useBlockPersonStore = create<BlockPersonState>((set) => ({
  target: null,
  ask: (target) => set({ target }),
  close: () => set({ target: null }),
}));

/** Opens the confirmation of blocking `target`. */
export function askToBlock(target: BlockTarget): void {
  useBlockPersonStore.getState().ask(target);
}
