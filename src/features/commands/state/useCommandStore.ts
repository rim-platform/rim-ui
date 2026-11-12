import { create } from "zustand";

/** The kind of target a palette command asks for before it runs. */
export type TargetPickerKind =
  | "channel"
  | "direct"
  | "workspace"
  | "joinableChannel"
  | "member"
  | "messageableMember"
  | "macro"
  | "pipeline"
  | "agent";

/**
 * What the search box shows first: `commands`, the command palette's list, or `search`,
 * conversations, people and messages with commands after them.
 */
export type SearchBoxMode = "commands" | "search";

/** Where the search box looks for conversations, people and messages. */
export type SearchBoxScope = "workspace" | "everything";

/** A command the palette is picking a target for. */
export interface TargetPickerRequest {
  commandId: string;
  kind: TargetPickerKind;
}

type CommandState = {
  isCommandPaletteOpen: boolean;
  searchQuery: string;
  /** What the open search box shows first; `commands` whenever the palette opens. */
  mode: SearchBoxMode;
  scope: SearchBoxScope;
  /**
   * Opens the search box with search first, in `scope`.
   *
   * @param scope - The open workspace, or everything from Home and Unreads.
   */
  openSearchBox: (scope: SearchBoxScope) => void;
  setMode: (mode: SearchBoxMode) => void;
  setScope: (scope: SearchBoxScope) => void;
  /** The command the open palette is picking a target for, or null while it lists commands. */
  targetPicker: TargetPickerRequest | null;
  /** Opens the palette on the target list of `request`. */
  openTargetPicker: (request: TargetPickerRequest) => void;
  /** Returns the open palette from a target list to the command list. */
  closeTargetPicker: () => void;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  toggleCommandPalette: () => void;
  setSearchQuery: (query: string) => void;
  /** Whether the keyboard shortcuts panel is open. */
  isShortcutsPanelOpen: boolean;
  setShortcutsPanelOpen: (open: boolean) => void;
  toggleShortcutsPanel: () => void;
};

export const useCommandStore = create<CommandState>((set) => ({
  isCommandPaletteOpen: false,
  searchQuery: "",
  mode: "commands",
  scope: "workspace",
  openSearchBox: (scope) =>
    set({
      isCommandPaletteOpen: true,
      searchQuery: "",
      targetPicker: null,
      mode: "search",
      scope,
    }),
  setMode: (mode) => set({ mode }),
  setScope: (scope) => set({ scope }),
  targetPicker: null,
  openTargetPicker: (request) =>
    set({ isCommandPaletteOpen: true, searchQuery: "", targetPicker: request, mode: "commands" }),
  closeTargetPicker: () => set({ searchQuery: "", targetPicker: null }),
  openCommandPalette: () =>
    set({ isCommandPaletteOpen: true, searchQuery: "", targetPicker: null, mode: "commands" }),
  closeCommandPalette: () =>
    set({ isCommandPaletteOpen: false, searchQuery: "", targetPicker: null, mode: "commands" }),
  // Over the search box in search mode, the palette's keys switch it to commands instead.
  toggleCommandPalette: () =>
    set((state) =>
      state.isCommandPaletteOpen && state.mode === "search" && !state.targetPicker
        ? { mode: "commands" }
        : {
            isCommandPaletteOpen: !state.isCommandPaletteOpen,
            searchQuery: state.isCommandPaletteOpen ? "" : state.searchQuery,
            targetPicker: null,
            mode: "commands",
          },
    ),
  setSearchQuery: (query) => set({ searchQuery: query }),
  isShortcutsPanelOpen: false,
  setShortcutsPanelOpen: (open) => set({ isShortcutsPanelOpen: open }),
  toggleShortcutsPanel: () =>
    set((state) => ({ isShortcutsPanelOpen: !state.isShortcutsPanelOpen })),
}));
