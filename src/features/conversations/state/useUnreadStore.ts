import { create } from "zustand";

interface UnreadState {
  counts: Record<string, number>;
  setCounts: (counts: Record<string, number>) => void;
  increment: (conversationId: string) => void;
  markRead: (conversationId: string) => void;
  markAllRead: () => void;
  // Watermarks track the sentAt timestamp of the last seen message per conversation.
  // When a watermark exists, the MessageTimeline renders a "New messages" divider.
  watermarks: Record<string, string>;
  setWatermark: (conversationId: string, sentAt: string) => void;
  clearWatermark: (conversationId: string) => void;
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
  watermarks: {},
  setWatermark: (conversationId, sentAt) =>
    set((state) => ({
      watermarks: { ...state.watermarks, [conversationId]: sentAt },
    })),
  clearWatermark: (conversationId) =>
    set((state) => {
      const next = { ...state.watermarks };
      delete next[conversationId];
      return { watermarks: next };
    }),
}));
