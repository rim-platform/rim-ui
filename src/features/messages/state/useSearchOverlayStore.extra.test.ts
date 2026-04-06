import { describe, it, expect, beforeEach } from "vitest";
import { useSearchOverlayStore } from "./useSearchOverlayStore";

describe("useSearchOverlayStore (extra coverage)", () => {
  beforeEach(() => {
    useSearchOverlayStore.setState({
      isOpen: false,
      query: "",
      scope: { kind: "all" },
      recentSearches: [],
    });
  });

  describe("openWithScope", () => {
    it("opens overlay with 'all' scope", () => {
      useSearchOverlayStore.getState().openWithScope({ kind: "all" });
      const state = useSearchOverlayStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.scope).toEqual({ kind: "all" });
      expect(state.query).toBe("");
    });

    it("opens overlay with conversation scope", () => {
      useSearchOverlayStore.getState().openWithScope({
        kind: "conversation",
        conversationId: "conv-1",
      });
      const state = useSearchOverlayStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.scope).toEqual({
        kind: "conversation",
        conversationId: "conv-1",
      });
    });

    it("resets query when opening", () => {
      useSearchOverlayStore.getState().setQuery("old query");
      useSearchOverlayStore.getState().openWithScope({ kind: "all" });
      expect(useSearchOverlayStore.getState().query).toBe("");
    });
  });

  describe("close", () => {
    it("closes the overlay and clears query", () => {
      useSearchOverlayStore.getState().openWithScope({ kind: "all" });
      useSearchOverlayStore.getState().setQuery("test");
      useSearchOverlayStore.getState().close();

      const state = useSearchOverlayStore.getState();
      expect(state.isOpen).toBe(false);
      expect(state.query).toBe("");
    });
  });

  describe("setQuery", () => {
    it("sets the search query", () => {
      useSearchOverlayStore.getState().setQuery("hello");
      expect(useSearchOverlayStore.getState().query).toBe("hello");
    });

    it("can set to empty string", () => {
      useSearchOverlayStore.getState().setQuery("something");
      useSearchOverlayStore.getState().setQuery("");
      expect(useSearchOverlayStore.getState().query).toBe("");
    });
  });

  describe("addRecentSearch", () => {
    it("adds a search query to recent searches", () => {
      useSearchOverlayStore.getState().addRecentSearch("hello");
      expect(useSearchOverlayStore.getState().recentSearches).toContain("hello");
    });

    it("puts newest search first", () => {
      useSearchOverlayStore.getState().addRecentSearch("first");
      useSearchOverlayStore.getState().addRecentSearch("second");
      const recent = useSearchOverlayStore.getState().recentSearches;
      expect(recent[0]).toBe("second");
      expect(recent[1]).toBe("first");
    });

    it("deduplicates existing entries", () => {
      useSearchOverlayStore.getState().addRecentSearch("hello");
      useSearchOverlayStore.getState().addRecentSearch("world");
      useSearchOverlayStore.getState().addRecentSearch("hello");
      const recent = useSearchOverlayStore.getState().recentSearches;
      expect(recent.filter((s) => s === "hello")).toHaveLength(1);
      expect(recent[0]).toBe("hello");
    });

    it("limits to 10 recent searches", () => {
      for (let i = 0; i < 15; i++) {
        useSearchOverlayStore.getState().addRecentSearch(`search-${i}`);
      }
      expect(useSearchOverlayStore.getState().recentSearches).toHaveLength(10);
    });

    it("ignores empty/whitespace-only strings", () => {
      useSearchOverlayStore.getState().addRecentSearch("");
      useSearchOverlayStore.getState().addRecentSearch("   ");
      expect(useSearchOverlayStore.getState().recentSearches).toHaveLength(0);
    });

    it("trims whitespace from searches", () => {
      useSearchOverlayStore.getState().addRecentSearch("  hello  ");
      expect(useSearchOverlayStore.getState().recentSearches[0]).toBe("hello");
    });
  });
});
