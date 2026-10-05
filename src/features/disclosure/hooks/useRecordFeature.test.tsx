import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

import { useDisclosureStore } from "../state/useDisclosureStore";
import { FEATURE_IDS } from "../constants";
import { useRecordFeature } from "./useRecordFeature";

describe("useRecordFeature", () => {
  const recordUsage = vi.fn();

  beforeEach(() => {
    recordUsage.mockReset();
    useDisclosureStore.setState({ recordUsage });
  });

  it("records the feature once per mount, not on re-render", () => {
    const { rerender } = renderHook(() => useRecordFeature(FEATURE_IDS.THREADS));
    rerender();
    rerender();
    expect(recordUsage).toHaveBeenCalledTimes(1);
    expect(recordUsage).toHaveBeenCalledWith("threads");
  });

  it("records again for a fresh mount", () => {
    renderHook(() => useRecordFeature(FEATURE_IDS.SEARCH)).unmount();
    renderHook(() => useRecordFeature(FEATURE_IDS.SEARCH));
    expect(recordUsage).toHaveBeenCalledTimes(2);
  });
});
