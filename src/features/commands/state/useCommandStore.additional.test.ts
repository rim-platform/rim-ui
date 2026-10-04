import { describe, it, expect, beforeEach } from "vitest";
import { useCommandStore } from "./useCommandStore";

describe("useCommandStore — additional", () => {
  beforeEach(() => {
    useCommandStore.setState({
      isCommandPaletteOpen: false,
      searchQuery: "",
    });
  });

  it("openCommandPalette sets open and clears query", () => {
    useCommandStore.setState({ searchQuery: "old" });
    useCommandStore.getState().openCommandPalette();
    expect(useCommandStore.getState().isCommandPaletteOpen).toBe(true);
    expect(useCommandStore.getState().searchQuery).toBe("");
  });

  it("closeCommandPalette sets closed and clears query", () => {
    useCommandStore.setState({ isCommandPaletteOpen: true, searchQuery: "test" });
    useCommandStore.getState().closeCommandPalette();
    expect(useCommandStore.getState().isCommandPaletteOpen).toBe(false);
    expect(useCommandStore.getState().searchQuery).toBe("");
  });

  it("toggleCommandPalette opens when closed", () => {
    useCommandStore.getState().toggleCommandPalette();
    expect(useCommandStore.getState().isCommandPaletteOpen).toBe(true);
  });

  it("toggleCommandPalette closes when open and clears query", () => {
    useCommandStore.setState({ isCommandPaletteOpen: true, searchQuery: "test" });
    useCommandStore.getState().toggleCommandPalette();
    expect(useCommandStore.getState().isCommandPaletteOpen).toBe(false);
    expect(useCommandStore.getState().searchQuery).toBe("");
  });

  it("setSearchQuery updates query", () => {
    useCommandStore.getState().setSearchQuery("search term");
    expect(useCommandStore.getState().searchQuery).toBe("search term");
  });

  it("toggle preserves query when opening", () => {
    useCommandStore.setState({ searchQuery: "existing" });
    useCommandStore.getState().toggleCommandPalette();
    // When opening, existing query is preserved
    expect(useCommandStore.getState().searchQuery).toBe("existing");
    expect(useCommandStore.getState().isCommandPaletteOpen).toBe(true);
  });
});
