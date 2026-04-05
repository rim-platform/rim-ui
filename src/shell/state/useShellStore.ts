import { create } from "zustand";

export type ActivePanel = "inbox" | "plugins";

export type MainSurface =
  | { kind: "conversation" }
  | { kind: "settings" }
  | { kind: "plugin"; pluginId: string }
  | { kind: "marketplace" };

export type ActivePluginPanel = {
  pluginId: string;
  panelId: string;
} | null;

type ShellState = {
  activePanel: ActivePanel;
  mainSurface: MainSurface;
  activePluginPanel: ActivePluginPanel;
  selectedConversationId: string | null;
  selectedRootMessageId: string | null;
  isThreadOpen: boolean;
  focusedSurface: string | null;
  editingMessageId: string | null;
  highlightedMessageId: string | null;
  sidebarCollapsed: boolean;
  lastClosedThreadId: string | null;
  showNewChannelDialog: boolean;
  showNewMessagePicker: boolean;
  pinnedPanelOpen: boolean;

  setActivePanel: (panel: ActivePanel) => void;
  setMainSurface: (surface: MainSurface) => void;
  setActivePluginPanel: (panel: ActivePluginPanel) => void;
  openPluginPanel: (pluginId: string, panelId: string) => void;
  closePluginPanel: () => void;
  setSelectedConversationId: (id: string | null) => void;
  openThreadForMessage: (rootMessageId: string) => void;
  closeThread: () => void;
  toggleSidebar: () => void;
  setFocusedSurface: (surface: string | null) => void;
  setEditingMessageId: (id: string | null) => void;
  setHighlightedMessageId: (id: string | null) => void;
  setShowNewChannelDialog: (show: boolean) => void;
  setShowNewMessagePicker: (show: boolean) => void;
  setPinnedPanelOpen: (open: boolean) => void;
  reset: () => void;
};

export const useShellStore = create<ShellState>((set) => ({
  activePanel: "inbox",
  mainSurface: { kind: "conversation" },
  activePluginPanel: null,
  selectedConversationId: null,
  selectedRootMessageId: null,
  isThreadOpen: false,
  focusedSurface: null,
  editingMessageId: null,
  highlightedMessageId: null,
  sidebarCollapsed: false,
  lastClosedThreadId: null,
  showNewChannelDialog: false,
  showNewMessagePicker: false,
  pinnedPanelOpen: false,

  setActivePanel: (panel) => set({ activePanel: panel }),
  setMainSurface: (surface) => set({ mainSurface: surface }),
  setActivePluginPanel: (panel) => set({ activePluginPanel: panel }),
  openPluginPanel: (pluginId, panelId) =>
    set({
      mainSurface: { kind: "conversation" },
      activePluginPanel: { pluginId, panelId },
    }),
  closePluginPanel: () => set({ activePluginPanel: null }),

  setSelectedConversationId: (id) =>
    set({ selectedConversationId: id, selectedRootMessageId: null, isThreadOpen: false, editingMessageId: null }),

  openThreadForMessage: (rootMessageId) =>
    set({ selectedRootMessageId: rootMessageId, isThreadOpen: true }),

  closeThread: () =>
    set((state) => ({
      lastClosedThreadId: state.selectedRootMessageId,
      selectedRootMessageId: null,
      isThreadOpen: false,
    })),

  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  setFocusedSurface: (surface) => set({ focusedSurface: surface }),

  setEditingMessageId: (id) => set({ editingMessageId: id }),

  setHighlightedMessageId: (id) => set({ highlightedMessageId: id }),

  setShowNewChannelDialog: (show) => set({ showNewChannelDialog: show }),
  setShowNewMessagePicker: (show) => set({ showNewMessagePicker: show }),
  setPinnedPanelOpen: (open) => set({ pinnedPanelOpen: open }),

  reset: () =>
    set({
      activePanel: "inbox",
      mainSurface: { kind: "conversation" },
      activePluginPanel: null,
      selectedConversationId: null,
      selectedRootMessageId: null,
      isThreadOpen: false,
      focusedSurface: null,
      editingMessageId: null,
      highlightedMessageId: null,
      sidebarCollapsed: false,
      lastClosedThreadId: null,
      showNewChannelDialog: false,
      showNewMessagePicker: false,
      pinnedPanelOpen: false,
    }),
}));
