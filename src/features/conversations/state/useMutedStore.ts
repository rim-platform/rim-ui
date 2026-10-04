import { create } from "zustand";

interface MutedState {
  mutedIds: Set<string>;
  isMuted: (conversationId: string) => boolean;
  mute: (conversationId: string) => void;
  unmute: (conversationId: string) => void;
  setMutedIds: (ids: string[]) => void;
}

export const useMutedStore = create<MutedState>((set, get) => ({
  mutedIds: new Set(),
  isMuted: (conversationId) => get().mutedIds.has(conversationId),
  mute: (conversationId) =>
    set((state) => {
      const next = new Set(state.mutedIds);
      next.add(conversationId);
      return { mutedIds: next };
    }),
  unmute: (conversationId) =>
    set((state) => {
      const next = new Set(state.mutedIds);
      next.delete(conversationId);
      return { mutedIds: next };
    }),
  setMutedIds: (ids) => set({ mutedIds: new Set(ids) }),
}));
