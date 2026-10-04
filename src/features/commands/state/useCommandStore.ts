import { create } from "zustand";

type CommandState = {
  isCommandPaletteOpen: boolean;
  searchQuery: string;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  toggleCommandPalette: () => void;
  setSearchQuery: (query: string) => void;
};

export const useCommandStore = create<CommandState>((set) => ({
  isCommandPaletteOpen: false,
  searchQuery: "",
  openCommandPalette: () => set({ isCommandPaletteOpen: true, searchQuery: "" }),
  closeCommandPalette: () => set({ isCommandPaletteOpen: false, searchQuery: "" }),
  toggleCommandPalette: () =>
    set((state) => ({
      isCommandPaletteOpen: !state.isCommandPaletteOpen,
      searchQuery: state.isCommandPaletteOpen ? "" : state.searchQuery,
    })),
  setSearchQuery: (query) => set({ searchQuery: query }),
}));
