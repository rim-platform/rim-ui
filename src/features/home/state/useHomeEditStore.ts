import { create } from "zustand";

import type { HomeLayoutDoc } from "../layout/homeLayout";

interface HomeEditState {
  /** Edit Home was asked for and Home has not opened its editor yet. */
  requested: boolean;
  /** The layout being edited, or `null` while Home is not being edited. */
  draft: HomeLayoutDoc | null;
  request: () => void;
  start: (layout: HomeLayoutDoc) => void;
  update: (layout: HomeLayoutDoc) => void;
  stop: () => void;
}

/** Whether Home is being edited, and the layout as edited so far. Nothing here is kept. */
export const useHomeEditStore = create<HomeEditState>((set) => ({
  requested: false,
  draft: null,
  request: () => set({ requested: true }),
  start: (layout) => set({ requested: false, draft: layout }),
  update: (layout) => set({ draft: layout }),
  stop: () => set({ requested: false, draft: null }),
}));
