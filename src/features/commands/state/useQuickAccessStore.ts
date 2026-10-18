import { create } from "zustand";
import type { HoverTarget } from "../../../shell/state/useHoverContextStore";

interface QuickAccessState {
  isOpen: boolean;
  target: HoverTarget | null;
  open: (target: HoverTarget) => void;
  close: () => void;
}

export const useQuickAccessStore = create<QuickAccessState>((set) => ({
  isOpen: false,
  target: null,
  open: (target) => set({ isOpen: true, target }),
  close: () => set({ isOpen: false, target: null }),
}));

/** The keys that open the assigner on the hovered item, as a menu shows them. */
export const QUICK_ACCESS_SHORTCUT = "Ctrl+Shift+B";
