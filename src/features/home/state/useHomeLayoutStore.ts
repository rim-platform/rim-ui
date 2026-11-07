import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { registerSealedStore, sealedStateStorage } from "../../../core/accountVault/sealedStorage";
import type { HomeLayoutDoc } from "../layout/homeLayout";

/** A layout with the time the person made it, as the server keeps it. */
export interface DatedLayout {
  layout: HomeLayoutDoc;
  /** When the person made the edit, an ISO time. */
  editedAt: string;
}

interface HomeLayoutState {
  /** The last layout the server answered, or `null` when it holds none or none was read yet. */
  copy: DatedLayout | null;
  /** An edit the server has not taken yet, sent once it answers. */
  pending: DatedLayout | null;
  /** The layout changed on another device and the person has not read the notice yet. */
  changedElsewhere: boolean;
  setCopy: (copy: DatedLayout | null) => void;
  setPending: (pending: DatedLayout | null) => void;
  setChangedElsewhere: (changed: boolean) => void;
}

/**
 * This device's copy of the account's Home layout and the edit waiting to be sent, kept per
 * account under the account vault. What the boxes show is never kept here.
 */
export const useHomeLayoutStore = create<HomeLayoutState>()(
  persist(
    (set) => ({
      copy: null,
      pending: null,
      changedElsewhere: false,
      setCopy: (copy) => set({ copy }),
      setPending: (pending) => set({ pending }),
      setChangedElsewhere: (changedElsewhere) => set({ changedElsewhere }),
    }),
    {
      name: "rim-home-layout",
      partialize: (state) => ({
        copy: state.copy,
        pending: state.pending,
        changedElsewhere: state.changedElsewhere,
      }),
      storage: createJSONStorage(() => sealedStateStorage),
      skipHydration: true,
    },
  ),
);
registerSealedStore(useHomeLayoutStore);

interface HomeHiddenState {
  /** The ids of the boxes not shown on this device. */
  hidden: string[];
  hide: (id: string) => void;
  show: (id: string) => void;
}

/**
 * The boxes hidden on this device only, kept per account under the account vault apart from the
 * layout. It never reaches the server, so every other device still shows them.
 */
export const useHomeHiddenStore = create<HomeHiddenState>()(
  persist(
    (set) => ({
      hidden: [],
      hide: (id) =>
        set((state) => (state.hidden.includes(id) ? state : { hidden: [...state.hidden, id] })),
      show: (id) => set((state) => ({ hidden: state.hidden.filter((other) => other !== id) })),
    }),
    {
      name: "rim-home-hidden",
      partialize: (state) => ({ hidden: state.hidden }),
      storage: createJSONStorage(() => sealedStateStorage),
      skipHydration: true,
    },
  ),
);
registerSealedStore(useHomeHiddenStore);
