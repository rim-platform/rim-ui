import { create } from "zustand";

/** The kind of target a palette command asks for before it runs. */
export type TargetPickerKind = "channel" | "direct" | "workspace" | "joinableChannel";

/** A command the palette is picking a target for. */
export interface TargetPickerRequest {
  commandId: string;
  kind: TargetPickerKind;
}

type CommandState = {
  isCommandPaletteOpen: boolean;
  searchQuery: string;
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
  targetPicker: null,
  openTargetPicker: (request) =>
    set({ isCommandPaletteOpen: true, searchQuery: "", targetPicker: request }),
  closeTargetPicker: () => set({ searchQuery: "", targetPicker: null }),
  openCommandPalette: () =>
    set({ isCommandPaletteOpen: true, searchQuery: "", targetPicker: null }),
  closeCommandPalette: () =>
    set({ isCommandPaletteOpen: false, searchQuery: "", targetPicker: null }),
  toggleCommandPalette: () =>
    set((state) => ({
      isCommandPaletteOpen: !state.isCommandPaletteOpen,
      searchQuery: state.isCommandPaletteOpen ? "" : state.searchQuery,
      targetPicker: null,
    })),
  setSearchQuery: (query) => set({ searchQuery: query }),
  isShortcutsPanelOpen: false,
  setShortcutsPanelOpen: (open) => set({ isShortcutsPanelOpen: open }),
  toggleShortcutsPanel: () =>
    set((state) => ({ isShortcutsPanelOpen: !state.isShortcutsPanelOpen })),
}));
