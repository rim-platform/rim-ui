import { create } from "zustand";

export type PresenceStatus = "ONLINE" | "AWAY" | "OFFLINE";

interface PresenceState {
  presenceMap: Record<string, PresenceStatus>; // userId -> status
  setPresence: (userId: string, status: PresenceStatus) => void;
  setBulk: (entries: { userId: string; status: PresenceStatus }[]) => void;
}

export const usePresenceStore = create<PresenceState>((set) => ({
  presenceMap: {},
  setPresence: (userId, status) =>
    set((state) => ({
      presenceMap: { ...state.presenceMap, [userId]: status },
    })),
  setBulk: (entries) =>
    set((state) => {
      const next = { ...state.presenceMap };
      for (const entry of entries) {
        next[entry.userId] = entry.status;
      }
      return { presenceMap: next };
    }),
}));
