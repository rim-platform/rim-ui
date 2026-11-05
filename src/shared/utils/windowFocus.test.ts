import { afterEach, describe, expect, it, vi } from "vitest";

import { windowHasFocus } from "./windowFocus";

describe("windowHasFocus", () => {
  afterEach(() => vi.restoreAllMocks());

  function state(visibility: DocumentVisibilityState, focused: boolean) {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue(visibility);
    vi.spyOn(document, "hasFocus").mockReturnValue(focused);
  }

  it("is true for a visible window with focus", () => {
    state("visible", true);
    expect(windowHasFocus()).toBe(true);
  });

  it("is false for a visible window without focus", () => {
    state("visible", false);
    expect(windowHasFocus()).toBe(false);
  });

  it("is false for a hidden window that still reports focus", () => {
    state("hidden", true);
    expect(windowHasFocus()).toBe(false);
  });
});
