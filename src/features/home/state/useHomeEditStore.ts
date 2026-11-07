import { create } from "zustand";

import type { HomeLayoutDoc } from "../layout/homeLayout";

interface HomeEditState {
  /** Edit Home was asked for and Home has not opened its editor yet. */
  requested: boolean;
  /** The layout being edited, or `null` while Home is not being edited. */
  draft: HomeLayoutDoc | null;
  /** The box whose settings the editor opened at, or `null`. */
  settingsBoxId: string | null;
  request: () => void;
  /** Starts editing `layout`, with the settings of the box `settingsBoxId` open when given. */
  start: (layout: HomeLayoutDoc, settingsBoxId?: string) => void;
  update: (layout: HomeLayoutDoc) => void;
  /** Closes the settings the editor opened at. */
  closeSettings: () => void;
  stop: () => void;
}

/** Whether Home is being edited, and the layout as edited so far. Nothing here is kept. */
export const useHomeEditStore = create<HomeEditState>((set) => ({
  requested: false,
  draft: null,
  settingsBoxId: null,
  request: () => set({ requested: true }),
  start: (layout, settingsBoxId) =>
    set({ requested: false, draft: layout, settingsBoxId: settingsBoxId ?? null }),
  update: (layout) => set({ draft: layout }),
  closeSettings: () => set({ settingsBoxId: null }),
  stop: () => set({ requested: false, draft: null, settingsBoxId: null }),
}));
