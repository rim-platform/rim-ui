import { beforeEach, describe, expect, it } from "vitest";

import { useMessageFoldStore } from "./useMessageFoldStore";

beforeEach(() => {
  useMessageFoldStore.setState({ foldable: new Set(), expanded: new Set() });
});

describe("useMessageFoldStore", () => {
  it("setFoldable adds and removes a message", () => {
    useMessageFoldStore.getState().setFoldable("m-1", true);
    expect(useMessageFoldStore.getState().foldable.has("m-1")).toBe(true);

    useMessageFoldStore.getState().setFoldable("m-1", false);
    expect(useMessageFoldStore.getState().foldable.has("m-1")).toBe(false);
  });

  it("toggleExpanded adds and removes a message", () => {
    useMessageFoldStore.getState().toggleExpanded("m-1");
    expect(useMessageFoldStore.getState().expanded.has("m-1")).toBe(true);

    useMessageFoldStore.getState().toggleExpanded("m-1");
    expect(useMessageFoldStore.getState().expanded.has("m-1")).toBe(false);
  });

  it("keeps the same set when an update changes nothing", () => {
    const before = useMessageFoldStore.getState();
    useMessageFoldStore.getState().setFoldable("m-1", false);
    expect(useMessageFoldStore.getState()).toBe(before);

    useMessageFoldStore.getState().setFoldable("m-1", true);
    const foldable = useMessageFoldStore.getState().foldable;
    useMessageFoldStore.getState().setFoldable("m-1", true);
    expect(useMessageFoldStore.getState().foldable).toBe(foldable);
  });
});
