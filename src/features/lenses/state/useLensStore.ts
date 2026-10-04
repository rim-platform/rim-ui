import { create } from "zustand";

type LensState = {
  activeLenses: Record<string, string | null>;
  lensPickerOpen: boolean;

  setActiveLens: (conversationId: string, lensId: string | null) => void;
  getActiveLens: (conversationId: string) => string | null;
  setLensPickerOpen: (open: boolean) => void;
};

export const useLensStore = create<LensState>((set, get) => ({
  activeLenses: {},
  lensPickerOpen: false,

  setActiveLens: (conversationId, lensId) =>
    set((state) => ({
      activeLenses: { ...state.activeLenses, [conversationId]: lensId },
    })),

  getActiveLens: (conversationId) => get().activeLenses[conversationId] ?? null,

  setLensPickerOpen: (open) => set({ lensPickerOpen: open }),
}));
