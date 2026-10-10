import { create } from "zustand";

/** Normal mode moves and runs commands; insert mode leaves every key to the focused field. */
export type VimMode = "normal" | "insert";

interface VimState {
  mode: VimMode;
  /** Keys typed so far of an unfinished normal-mode command, such as "3" or "g". */
  pending: string;
  setMode: (mode: VimMode) => void;
  setPending: (pending: string) => void;
}

export const useVimStore = create<VimState>((set) => ({
  mode: "normal",
  pending: "",
  setMode: (mode) => set({ mode }),
  setPending: (pending) => set({ pending }),
}));
