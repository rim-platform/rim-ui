import { create } from "zustand";

export type ActivePanel = "inbox" | "plugins";

export type DisplayDensity = "comfortable" | "compact" | "ultra-compact";

export type MainSurface =
  | { kind: "conversation" }
  /**
   * Opens the Settings page. Pass an optional `tab` to land on a specific
   * settings tab (e.g. `"plugins"`). Falls back to `"profile"` when absent.
   * Use a string literal rather than importing `SettingsTab` to avoid a
   * circular dependency with the settings feature module.
   */
  | { kind: "settings"; tab?: string }
  | { kind: "plugin"; pluginId: string }
  | { kind: "marketplace" }
  /**
   * Opens the Incidents hub. Pass an optional `tab` to land on a specific sub-tab (e.g.
   * `"oncall"` — used by the `oncall.who` command and the status-bar `OnCallIndicator`).
   * Falls back to `"history"` when absent. Same trick as the `settings` surface's `tab`.
   */
  | { kind: "incidents"; tab?: "history" | "oncall" | "escalation" }
  | { kind: "audit-log" };

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
  showInviteDialog: boolean;
  pinnedPanelOpen: boolean;
  displayDensity: DisplayDensity;
  zenMode: boolean;
  navigationMode: boolean;

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
  setShowInviteDialog: (show: boolean) => void;
  setPinnedPanelOpen: (open: boolean) => void;
  cycleDisplayDensity: () => void;
  toggleZenMode: () => void;
  setNavigationMode: (enabled: boolean) => void;
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
  showInviteDialog: false,
  pinnedPanelOpen: false,
  displayDensity: "comfortable",
  zenMode: false,
  navigationMode: false,

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
    set({
      selectedConversationId: id,
      selectedRootMessageId: null,
      isThreadOpen: false,
      editingMessageId: null,
    }),

  openThreadForMessage: (rootMessageId) =>
    set({ selectedRootMessageId: rootMessageId, isThreadOpen: true }),

  closeThread: () =>
    set((state) => ({
      lastClosedThreadId: state.selectedRootMessageId,
      selectedRootMessageId: null,
      isThreadOpen: false,
    })),

  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  setFocusedSurface: (surface) => set({ focusedSurface: surface }),

  setEditingMessageId: (id) => set({ editingMessageId: id }),

  setHighlightedMessageId: (id) => set({ highlightedMessageId: id }),

  setShowNewChannelDialog: (show) => set({ showNewChannelDialog: show }),
  setShowNewMessagePicker: (show) => set({ showNewMessagePicker: show }),
  setShowInviteDialog: (show) => set({ showInviteDialog: show }),
  setPinnedPanelOpen: (open) => set({ pinnedPanelOpen: open }),

  cycleDisplayDensity: () =>
    set((state) => {
      const order: DisplayDensity[] = ["comfortable", "compact", "ultra-compact"];
      const idx = order.indexOf(state.displayDensity);
      const next = order[(idx + 1) % order.length];
      return { displayDensity: next };
    }),

  toggleZenMode: () => set((state) => ({ zenMode: !state.zenMode })),

  setNavigationMode: (enabled) => set({ navigationMode: enabled }),

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
      showInviteDialog: false,
      pinnedPanelOpen: false,
      displayDensity: "comfortable",
      zenMode: false,
      navigationMode: false,
    }),
}));
