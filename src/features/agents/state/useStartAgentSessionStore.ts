import { create } from "zustand";

interface StartAgentSessionState {
  /** Whether the start dialog is open. */
  open: boolean;
  show: () => void;
  close: () => void;
}

/** Whether the dialog that starts an agent session is open. */
export const useStartAgentSessionStore = create<StartAgentSessionState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  close: () => set({ open: false }),
}));
