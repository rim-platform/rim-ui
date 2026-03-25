import { create } from "zustand";

export type ActivePanel = "inbox" | "search" | "plugins";

export type MainSurface =
  | { kind: "conversation" }
  | { kind: "settings" };

type ShellState = {
  activePanel: ActivePanel;
  mainSurface: MainSurface;
  selectedConversationId: string | null;
  selectedRootMessageId: string | null;
  isThreadOpen: boolean;
  focusedSurface: string | null;

  setActivePanel: (panel: ActivePanel) => void;
  setMainSurface: (surface: MainSurface) => void;
  setSelectedConversationId: (id: string | null) => void;
  openThreadForMessage: (rootMessageId: string) => void;
  closeThread: () => void;
  setFocusedSurface: (surface: string | null) => void;
};

export const useShellStore = create<ShellState>((set) => ({
  activePanel: "inbox",
  mainSurface: { kind: "conversation" },
  selectedConversationId: null,
  selectedRootMessageId: null,
  isThreadOpen: false,
  focusedSurface: null,

  setActivePanel: (panel) => set({ activePanel: panel }),
  setMainSurface: (surface) => set({ mainSurface: surface }),

  setSelectedConversationId: (id) =>
    set({ selectedConversationId: id, selectedRootMessageId: null, isThreadOpen: false }),

  openThreadForMessage: (rootMessageId) =>
    set({ selectedRootMessageId: rootMessageId, isThreadOpen: true }),

  closeThread: () =>
    set({ selectedRootMessageId: null, isThreadOpen: false }),

  setFocusedSurface: (surface) => set({ focusedSurface: surface }),
}));
