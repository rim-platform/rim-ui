import { describe, it, expect, beforeEach } from "vitest";

import { useLensStore } from "./useLensStore";

describe("useLensStore", () => {
  beforeEach(() => {
    useLensStore.setState({ activeLenses: {}, lensPickerOpen: false });
  });

  it("has no active lens for an unseen conversation", () => {
    expect(useLensStore.getState().getActiveLens("conv-1")).toBeNull();
  });

  it("tracks the active lens per conversation", () => {
    const { setActiveLens } = useLensStore.getState();
    setActiveLens("conv-1", "lens-a");
    setActiveLens("conv-2", "lens-b");

    expect(useLensStore.getState().getActiveLens("conv-1")).toBe("lens-a");
    expect(useLensStore.getState().getActiveLens("conv-2")).toBe("lens-b");

    setActiveLens("conv-1", null);
    expect(useLensStore.getState().getActiveLens("conv-1")).toBeNull();
    expect(useLensStore.getState().getActiveLens("conv-2")).toBe("lens-b");
  });

  it("opens and closes the picker", () => {
    useLensStore.getState().setLensPickerOpen(true);
    expect(useLensStore.getState().lensPickerOpen).toBe(true);
    useLensStore.getState().setLensPickerOpen(false);
    expect(useLensStore.getState().lensPickerOpen).toBe(false);
  });
});
