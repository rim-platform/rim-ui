import { create } from "zustand";

/** What the commands of the Unreads page do while it is open. */
export interface UnreadsPageControls {
  next: () => void;
  previous: () => void;
  markGroup: () => void;
  open: () => void;
  undo: () => void;
  markAllShown: () => void;
  toggleMuted: () => void;
}

interface UnreadsPageState {
  /** Set while the page is mounted. */
  controls: UnreadsPageControls | null;
  setControls: (controls: UnreadsPageControls | null) => void;
}

/** The link from the page's commands, which run outside React, to the page on screen. */
export const useUnreadsPageStore = create<UnreadsPageState>((set) => ({
  controls: null,
  setControls: (controls) => set({ controls }),
}));
