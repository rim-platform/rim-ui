import { create } from "zustand";

interface UnreadState {
  counts: Record<string, number>;
  setCounts: (counts: Record<string, number>) => void;
  increment: (conversationId: string) => void;
  markRead: (conversationId: string) => void;
  markAllRead: () => void;
}

export const useUnreadStore = create<UnreadState>((set) => ({
  counts: {},
  setCounts: (counts) => set({ counts }),
  increment: (conversationId) =>
    set((state) => ({
      counts: {
        ...state.counts,
        [conversationId]: (state.counts[conversationId] ?? 0) + 1,
      },
    })),
  markRead: (conversationId) =>
    set((state) => {
      if (!state.counts[conversationId]) return state;
      const next = { ...state.counts };
      delete next[conversationId];
      return { counts: next };
    }),
  markAllRead: () => set({ counts: {} }),
}));
