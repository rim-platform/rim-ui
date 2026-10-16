import { create } from "zustand";

import type { DirectMember } from "../../features/relay/conversations/startDirect";

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
  | { kind: "audit-log" };

/**
 * A direct message not created yet: with a workspace member, or with someone in a relay's
 * direct space. Its first message creates the conversation.
 */
export type DirectDraft =
  { workspaceId: string; otherUserId: string } | { spaceId: string; member: DirectMember };

export type ActivePluginPanel = {
  pluginId: string;
  panelId: string;
} | null;

type ShellState = {
  activePanel: ActivePanel;
  mainSurface: MainSurface;
  activePluginPanel: ActivePluginPanel;
  selectedConversationId: string | null;
  /** The direct message being drafted; no conversation is selected meanwhile. */
  draftDirect: DirectDraft | null;
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
  /** Selects a conversation (or none) and drops any draft direct message. */
  setSelectedConversationId: (id: string | null) => void;
  /** Opens a draft direct message in place of the selected conversation. */
  openDraftDirect: (draft: DirectDraft) => void;
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
  draftDirect: null,
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
      draftDirect: null,
      selectedRootMessageId: null,
      isThreadOpen: false,
      editingMessageId: null,
    }),

  openDraftDirect: (draft) =>
    set({
      selectedConversationId: null,
      draftDirect: draft,
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
      draftDirect: null,
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
