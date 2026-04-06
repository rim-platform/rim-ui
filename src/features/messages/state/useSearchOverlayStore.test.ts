import { describe, it, expect, beforeEach } from "vitest";
import { useSearchOverlayStore } from "./useSearchOverlayStore";

describe("useSearchOverlayStore", () => {
  beforeEach(() => {
    useSearchOverlayStore.setState({
      isOpen: false,
      query: "",
      scope: { kind: "all" },
      recentSearches: [],
    });
  });

  it("starts closed with empty query and 'all' scope", () => {
    const state = useSearchOverlayStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.query).toBe("");
    expect(state.scope).toEqual({ kind: "all" });
  });

  it("opens with 'all' scope", () => {
    useSearchOverlayStore.getState().openWithScope({ kind: "all" });
    const state = useSearchOverlayStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.scope).toEqual({ kind: "all" });
    expect(state.query).toBe("");
  });

  it("opens with conversation scope", () => {
    useSearchOverlayStore.getState().openWithScope({
      kind: "conversation",
      conversationId: "conv-1",
    });
    const state = useSearchOverlayStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.scope).toEqual({ kind: "conversation", conversationId: "conv-1" });
  });

  it("closes and resets query but keeps scope", () => {
    useSearchOverlayStore.getState().openWithScope({ kind: "all" });
    useSearchOverlayStore.getState().setQuery("test");
    useSearchOverlayStore.getState().close();
    const state = useSearchOverlayStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.query).toBe("");
  });

  it("sets query text", () => {
    useSearchOverlayStore.getState().setQuery("hello world");
    expect(useSearchOverlayStore.getState().query).toBe("hello world");
  });

  it("adds a recent search", () => {
    useSearchOverlayStore.getState().addRecentSearch("test query");
    expect(useSearchOverlayStore.getState().recentSearches).toEqual(["test query"]);
  });

  it("deduplicates recent searches and moves to front", () => {
    useSearchOverlayStore.getState().addRecentSearch("first");
    useSearchOverlayStore.getState().addRecentSearch("second");
    useSearchOverlayStore.getState().addRecentSearch("first");
    expect(useSearchOverlayStore.getState().recentSearches).toEqual(["first", "second"]);
  });

  it("trims whitespace from recent searches", () => {
    useSearchOverlayStore.getState().addRecentSearch("  padded  ");
    expect(useSearchOverlayStore.getState().recentSearches).toEqual(["padded"]);
  });

  it("ignores empty/whitespace-only recent searches", () => {
    useSearchOverlayStore.getState().addRecentSearch("   ");
    expect(useSearchOverlayStore.getState().recentSearches).toEqual([]);
  });

  it("limits recent searches to 10", () => {
    for (let i = 0; i < 15; i++) {
      useSearchOverlayStore.getState().addRecentSearch(`search-${i}`);
    }
    expect(useSearchOverlayStore.getState().recentSearches).toHaveLength(10);
    expect(useSearchOverlayStore.getState().recentSearches[0]).toBe("search-14");
  });
});
