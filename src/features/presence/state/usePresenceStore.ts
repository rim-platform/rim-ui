import { create } from "zustand";
import { PresenceStatus } from "../../../core/graphql/generated/schema-types";

export { PresenceStatus };

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
