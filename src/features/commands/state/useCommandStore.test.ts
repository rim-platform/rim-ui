import { describe, it, expect, beforeEach } from "vitest";
import { useCommandStore } from "./useCommandStore";

describe("useCommandStore", () => {
  beforeEach(() => {
    useCommandStore.setState({
      isCommandPaletteOpen: false,
      searchQuery: "",
    });
  });

  it("starts closed with empty search query", () => {
    const state = useCommandStore.getState();
    expect(state.isCommandPaletteOpen).toBe(false);
    expect(state.searchQuery).toBe("");
  });

  it("opens the command palette and resets query", () => {
    useCommandStore.getState().setSearchQuery("old query");
    useCommandStore.getState().openCommandPalette();
    const state = useCommandStore.getState();
    expect(state.isCommandPaletteOpen).toBe(true);
    expect(state.searchQuery).toBe("");
  });

  it("closes the command palette and resets query", () => {
    useCommandStore.getState().openCommandPalette();
    useCommandStore.getState().setSearchQuery("test");
    useCommandStore.getState().closeCommandPalette();
    const state = useCommandStore.getState();
    expect(state.isCommandPaletteOpen).toBe(false);
    expect(state.searchQuery).toBe("");
  });

  it("toggles from closed to open", () => {
    useCommandStore.getState().toggleCommandPalette();
    expect(useCommandStore.getState().isCommandPaletteOpen).toBe(true);
  });

  it("toggles from open to closed and clears query", () => {
    useCommandStore.getState().openCommandPalette();
    useCommandStore.getState().setSearchQuery("hello");
    useCommandStore.getState().toggleCommandPalette();
    const state = useCommandStore.getState();
    expect(state.isCommandPaletteOpen).toBe(false);
    expect(state.searchQuery).toBe("");
  });

  it("sets search query", () => {
    useCommandStore.getState().setSearchQuery("find something");
    expect(useCommandStore.getState().searchQuery).toBe("find something");
  });
});
