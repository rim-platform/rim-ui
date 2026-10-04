import { create } from "zustand";

export type SearchScope = { kind: "all" } | { kind: "conversation"; conversationId: string };

type SearchOverlayState = {
  isOpen: boolean;
  query: string;
  scope: SearchScope;
  recentSearches: string[];

  openWithScope: (scope: SearchScope) => void;
  close: () => void;
  setQuery: (query: string) => void;
  addRecentSearch: (query: string) => void;
};

const MAX_RECENT = 10;

export const useSearchOverlayStore = create<SearchOverlayState>((set) => ({
  isOpen: false,
  query: "",
  scope: { kind: "all" },
  recentSearches: [],

  openWithScope: (scope) => set({ isOpen: true, query: "", scope }),
  close: () => set({ isOpen: false, query: "" }),
  setQuery: (query) => set({ query }),
  addRecentSearch: (query) =>
    set((state) => {
      const trimmed = query.trim();
      if (!trimmed) return state;
      const filtered = state.recentSearches.filter((s) => s !== trimmed);
      return { recentSearches: [trimmed, ...filtered].slice(0, MAX_RECENT) };
    }),
}));
