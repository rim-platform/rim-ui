import { create } from "zustand";
import { PresenceStatus } from "../../../core/graphql/generated/schema-types";

export { PresenceStatus };

interface PresenceState {
  presenceMap: Record<string, PresenceStatus>; // userId -> status
  /** The user this client is signed in as, once it has said its own status. */
  selfId: string | null;
  setPresence: (userId: string, status: PresenceStatus) => void;
  setBulk: (entries: { userId: string; status: PresenceStatus }[]) => void;
  /** This client's own status, which the server's list and events never override. */
  setSelf: (userId: string, status: PresenceStatus) => void;
}

export const usePresenceStore = create<PresenceState>((set) => ({
  presenceMap: {},
  selfId: null,
  setPresence: (userId, status) =>
    set((state) =>
      userId === state.selfId
        ? state
        : {
            presenceMap: { ...state.presenceMap, [userId]: status },
          },
    ),
  setBulk: (entries) =>
    set((state) => {
      const next = { ...state.presenceMap };
      for (const entry of entries) {
        if (entry.userId === state.selfId) continue;
        next[entry.userId] = entry.status;
      }
      return { presenceMap: next };
    }),
  setSelf: (userId, status) =>
    set((state) => ({
      selfId: userId,
      presenceMap: { ...state.presenceMap, [userId]: status },
    })),
}));
