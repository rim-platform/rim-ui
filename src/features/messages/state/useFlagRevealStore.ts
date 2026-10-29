import { create } from "zustand";

interface FlagRevealState {
  /** Flagged messages the viewer chose to show. */
  revealed: ReadonlySet<string>;
  toggleRevealed: (messageId: string) => void;
}

/**
 * Which flagged messages the viewer uncovered with Show anyway, for the session, shared by the
 * timeline and the thread pane.
 */
export const useFlagRevealStore = create<FlagRevealState>((set) => ({
  revealed: new Set(),
  toggleRevealed: (messageId) =>
    set((s) => {
      const next = new Set(s.revealed);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return { revealed: next };
    }),
}));
