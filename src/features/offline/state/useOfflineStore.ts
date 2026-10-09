import { create } from "zustand";

type OfflineState = {
  /**
   * The app opened without reaching the server and shows what this device saved: the
   * signed-in account from the session record, the sidebar lists and history from the local
   * cache. Cleared once the server answers again.
   */
  offline: boolean;
  setOffline: (offline: boolean) => void;
};

export const useOfflineStore = create<OfflineState>((set) => ({
  offline: false,
  setOffline: (offline) => set({ offline }),
}));
