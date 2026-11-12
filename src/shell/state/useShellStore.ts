import { create } from "zustand";

import type { PluginPanelSlot } from "../../features/plugins/types";
import type { DirectMember } from "../../features/relay/conversations/startDirect";
import type { ShellWidth } from "../hooks/useShellWidth";

export type ActivePanel = "inbox";

export type DisplayDensity = "comfortable" | "compact" | "ultra-compact";

export type MainSurface =
  | { kind: "conversation" }
  /**
   * Opens the Settings page. Pass an optional `tab` to land on a specific
   * settings tab (e.g. `"plugins"`). Falls back to `"profile"` when absent.
   * Use a string literal rather than importing `SettingsTab` to avoid a
   * circular dependency with the settings feature module. With `tab: "plugins"`,
   * `plugin` names the installed plugin whose settings form opens there.
   */
  | { kind: "settings"; tab?: string; plugin?: string }
  | { kind: "plugin"; pluginId: string }
  | { kind: "audit-log" }
  /** The page across every workspace of what needs the person: requests, mentions, unread counts. */
  | { kind: "home" }
  /** Every unread message across the workspaces, staying until it is marked read. */
  | { kind: "unreads" }
  /**
   * The message requests of one workspace's conversations, or with `workspaceId: null`, those
   * from outside every workspace.
   */
  | { kind: "dm-requests"; workspaceId: string | null }
  /** The agent sessions RIM started on this computer: those running and the recent ones. */
  | { kind: "agent-sessions" }
  /** One agent session, by RIM's key for it. */
  | { kind: "agent-session"; key: string };

/**
 * A direct message not created yet: with a workspace member, or with someone in a relay's
 * direct space. Its first message creates the conversation.
 */
export type DirectDraft =
  { workspaceId: string; otherUserId: string } | { spaceId: string; member: DirectMember };

/**
 * Where a direct message opened from a workspace came from: that workspace and the conversation
 * it showed, the direct space the DM is in, and the DM opened (null while it is a draft).
 */
export type DirectOrigin = {
  workspaceId: string;
  conversationId: string | null;
  spaceId: string;
  openedId: string | null;
};

export type ActivePluginPanel = {
  pluginId: string;
  panelId: string;
  /** Where the panel shows: a `main_area` panel takes the place of the page shown. */
  slot: PluginPanelSlot;
} | null;

/** A place the person opened: a workspace, the page shown, and the conversation selected there. */
export type Place = {
  workspaceId: string;
  surface: MainSurface;
  conversationId: string | null;
};

/** The most places Back and Forward remember. */
export const HISTORY_LIMIT = 50;

/**
 * What tells two places apart: the workspace, the page with its tab or plugin, and the
 * conversation only while the page is the conversation.
 */
export function placeKey(place: Place): string {
  const { surface } = place;
  const page =
    surface.kind === "settings"
      ? `settings:${surface.tab ?? ""}`
      : surface.kind === "plugin"
        ? `plugin:${surface.pluginId}`
        : surface.kind === "dm-requests"
          ? `dm-requests:${surface.workspaceId ?? ""}`
          : surface.kind === "agent-session"
            ? `agent-session:${surface.key}`
            : surface.kind;
  const conversation = surface.kind === "conversation" ? (place.conversationId ?? "") : "";
  return `${place.workspaceId}|${page}|${conversation}`;
}

/** Options for selecting a conversation. */
export type SelectConversationOptions = {
  /** Leaves a main-area plugin panel open: for selections the user did not make. */
  keepPluginPanel?: boolean;
};

type ShellState = {
  /** The places opened, oldest first, for Back and Forward; at most {@link HISTORY_LIMIT}. */
  history: Place[];
  /** The entry of `history` shown now; -1 while it is empty. */
  historyIndex: number;
  /**
   * Records `place` as the one shown now. A place equal to the current one changes nothing; one
   * in the same workspace and page as a current entry with no conversation yet replaces it;
   * any other drops the entries after the current one and is added, the oldest going past the
   * limit.
   */
  recordPlace: (place: Place) => void;
  /**
   * Moves `delta` entries back (negative) or forward through the history.
   *
   * @returns The place moved to, or `null` when there is none in that direction.
   */
  stepHistory: (delta: number) => Place | null;
  activePanel: ActivePanel;
  mainSurface: MainSurface;
  activePluginPanel: ActivePluginPanel;
  selectedConversationId: string | null;
  /** The direct message being drafted; no conversation is selected meanwhile. */
  draftDirect: DirectDraft | null;
  /** Where the DM opened from a workspace came from, for the way back to it. */
  directOrigin: DirectOrigin | null;
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
  /** Whether Bots in this channel shows, in the slot the pinned messages use. */
  botsPanelOpen: boolean;
  displayDensity: DisplayDensity;
  zenMode: boolean;
  navigationMode: boolean;
  /** The width class of the shell, set from its measured width. */
  shellWidth: ShellWidth;
  /** Whether the navigation drawer is open: the rails and tool panel of a narrow window. */
  navDrawerOpen: boolean;

  setActivePanel: (panel: ActivePanel) => void;
  /**
   * Shows `surface` as the page. Going to another page closes a main-area plugin panel; a
   * tool-panel one stays.
   */
  setMainSurface: (surface: MainSurface) => void;
  setActivePluginPanel: (panel: ActivePluginPanel) => void;
  /** Opens a plugin panel over the page shown, which stays the same page. */
  openPluginPanel: (pluginId: string, panelId: string, slot: PluginPanelSlot) => void;
  closePluginPanel: () => void;
  /**
   * Selects a conversation (or none) and drops any draft direct message. Selecting one closes
   * a main-area plugin panel so the conversation shows, unless `keepPluginPanel`.
   */
  setSelectedConversationId: (id: string | null, options?: SelectConversationOptions) => void;
  /**
   * Opens a draft direct message in place of the selected conversation, closing a main-area
   * plugin panel.
   */
  openDraftDirect: (draft: DirectDraft) => void;
  setDirectOrigin: (origin: DirectOrigin | null) => void;
  /** Names the conversation a draft origin became, once its first message created it. */
  adoptDirectOrigin: (spaceId: string, conversationId: string) => void;
  openThreadForMessage: (rootMessageId: string) => void;
  closeThread: () => void;
  toggleSidebar: () => void;
  setFocusedSurface: (surface: string | null) => void;
  setEditingMessageId: (id: string | null) => void;
  setHighlightedMessageId: (id: string | null) => void;
  setShowNewChannelDialog: (show: boolean) => void;
  setShowNewMessagePicker: (show: boolean) => void;
  setShowInviteDialog: (show: boolean) => void;
  /** Shows or hides the pinned messages; showing them hides Bots in this channel. */
  setPinnedPanelOpen: (open: boolean) => void;
  /** Shows or hides Bots in this channel; showing it hides the pinned messages. */
  setBotsPanelOpen: (open: boolean) => void;
  cycleDisplayDensity: () => void;
  toggleZenMode: () => void;
  setNavigationMode: (enabled: boolean) => void;
  /** Sets the width class; any width but narrow closes the navigation drawer. */
  setShellWidth: (width: ShellWidth) => void;
  setNavDrawerOpen: (open: boolean) => void;
  toggleNavDrawer: () => void;
  reset: () => void;
};

/** Closes the active plugin panel when it takes the page's place; a tool-panel one stays. */
function withoutMainAreaPanel(state: ShellState): Partial<ShellState> {
  return state.activePluginPanel?.slot === "main_area" ? { activePluginPanel: null } : {};
}

/** Whether two surfaces are the same page: the same kind with the same tab, plugin or key. */
function sameSurface(a: MainSurface, b: MainSurface): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export const useShellStore = create<ShellState>((set, get) => ({
  history: [],
  historyIndex: -1,
  recordPlace: (place) =>
    set((state) => {
      const current = state.history[state.historyIndex];
      const key = placeKey(place);
      if (current && placeKey(current) === key) return {};
      const kept = state.history.slice(0, state.historyIndex + 1);
      const fillsCurrent =
        current &&
        current.conversationId === null &&
        current.surface.kind === "conversation" &&
        place.surface.kind === "conversation" &&
        current.workspaceId === place.workspaceId;
      if (fillsCurrent) kept[kept.length - 1] = place;
      else kept.push(place);
      const history = kept.slice(-HISTORY_LIMIT);
      return { history, historyIndex: history.length - 1 };
    }),
  stepHistory: (delta) => {
    const { history, historyIndex } = get();
    const index = historyIndex + delta;
    const place = history[index];
    if (index < 0 || !place) return null;
    set({ historyIndex: index });
    return place;
  },
  activePanel: "inbox",
  mainSurface: { kind: "conversation" },
  activePluginPanel: null,
  selectedConversationId: null,
  draftDirect: null,
  directOrigin: null,
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
  botsPanelOpen: false,
  displayDensity: "comfortable",
  zenMode: false,
  navigationMode: false,
  shellWidth: "wide",
  navDrawerOpen: false,

  setActivePanel: (panel) => set({ activePanel: panel }),
  setMainSurface: (surface) =>
    set((state) => ({
      mainSurface: surface,
      ...(sameSurface(state.mainSurface, surface) ? {} : withoutMainAreaPanel(state)),
    })),
  setActivePluginPanel: (panel) => set({ activePluginPanel: panel }),
  openPluginPanel: (pluginId, panelId, slot) =>
    set({ activePluginPanel: { pluginId, panelId, slot } }),
  closePluginPanel: () => set({ activePluginPanel: null }),

  setSelectedConversationId: (id, options) =>
    set((state) => ({
      selectedConversationId: id,
      draftDirect: null,
      selectedRootMessageId: null,
      isThreadOpen: false,
      editingMessageId: null,
      ...(id !== null && !options?.keepPluginPanel ? withoutMainAreaPanel(state) : {}),
    })),

  openDraftDirect: (draft) =>
    set((state) => ({
      selectedConversationId: null,
      draftDirect: draft,
      selectedRootMessageId: null,
      isThreadOpen: false,
      editingMessageId: null,
      ...withoutMainAreaPanel(state),
    })),

  setDirectOrigin: (origin) => set({ directOrigin: origin }),

  adoptDirectOrigin: (spaceId, conversationId) =>
    set((state) =>
      state.directOrigin?.spaceId === spaceId && state.directOrigin.openedId === null
        ? { directOrigin: { ...state.directOrigin, openedId: conversationId } }
        : {},
    ),

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
  setPinnedPanelOpen: (open) =>
    set(open ? { pinnedPanelOpen: true, botsPanelOpen: false } : { pinnedPanelOpen: false }),
  setBotsPanelOpen: (open) =>
    set(open ? { botsPanelOpen: true, pinnedPanelOpen: false } : { botsPanelOpen: false }),

  cycleDisplayDensity: () =>
    set((state) => {
      const order: DisplayDensity[] = ["comfortable", "compact", "ultra-compact"];
      const idx = order.indexOf(state.displayDensity);
      const next = order[(idx + 1) % order.length];
      return { displayDensity: next };
    }),

  toggleZenMode: () => set((state) => ({ zenMode: !state.zenMode })),

  setNavigationMode: (enabled) => set({ navigationMode: enabled }),

  setShellWidth: (width) =>
    set((state) =>
      state.shellWidth === width
        ? {}
        : { shellWidth: width, ...(width === "narrow" ? {} : { navDrawerOpen: false }) },
    ),
  setNavDrawerOpen: (open) => set({ navDrawerOpen: open }),
  toggleNavDrawer: () => set((state) => ({ navDrawerOpen: !state.navDrawerOpen })),

  reset: () =>
    set({
      history: [],
      historyIndex: -1,
      activePanel: "inbox",
      mainSurface: { kind: "conversation" },
      activePluginPanel: null,
      selectedConversationId: null,
      draftDirect: null,
      directOrigin: null,
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
      botsPanelOpen: false,
      displayDensity: "comfortable",
      zenMode: false,
      navigationMode: false,
      navDrawerOpen: false,
    }),
}));
