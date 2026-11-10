import { create } from "zustand";

interface StartAgentSessionState {
  /** Whether the start dialog is open. */
  open: boolean;
  /** What runs with the new session's key once the dialog starts one, or `null`. */
  onStarted: ((key: string) => void) | null;
  show: () => void;
  /** Opens the dialog, and runs `onStarted` with the key of the session it starts. */
  showThen: (onStarted: (key: string) => void) => void;
  close: () => void;
}

/** Whether the dialog that starts an agent session is open. */
export const useStartAgentSessionStore = create<StartAgentSessionState>((set) => ({
  open: false,
  onStarted: null,
  show: () => set({ open: true, onStarted: null }),
  showThen: (onStarted) => set({ open: true, onStarted }),
  close: () => set({ open: false, onStarted: null }),
}));
