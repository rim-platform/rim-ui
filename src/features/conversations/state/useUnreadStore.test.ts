import { describe, it, expect, beforeEach } from "vitest";
import { useUnreadStore } from "./useUnreadStore";

describe("useUnreadStore", () => {
  beforeEach(() => {
    useUnreadStore.setState({ counts: {} });
  });

  it("starts with empty counts", () => {
    expect(useUnreadStore.getState().counts).toEqual({});
  });

  it("sets counts from a bulk update", () => {
    useUnreadStore.getState().setCounts({ conv1: 3, conv2: 1 });
    expect(useUnreadStore.getState().counts).toEqual({ conv1: 3, conv2: 1 });
  });

  it("increments count for a conversation", () => {
    useUnreadStore.getState().increment("conv1");
    expect(useUnreadStore.getState().counts["conv1"]).toBe(1);
    useUnreadStore.getState().increment("conv1");
    expect(useUnreadStore.getState().counts["conv1"]).toBe(2);
  });

  it("increments from zero for unknown conversation", () => {
    useUnreadStore.getState().increment("unknown");
    expect(useUnreadStore.getState().counts["unknown"]).toBe(1);
  });

  it("marks a conversation as read", () => {
    useUnreadStore.getState().setCounts({ conv1: 5, conv2: 2 });
    useUnreadStore.getState().markRead("conv1");
    expect(useUnreadStore.getState().counts["conv1"]).toBeUndefined();
    expect(useUnreadStore.getState().counts["conv2"]).toBe(2);
  });

  it("markRead is a no-op for already-read conversations", () => {
    const before = useUnreadStore.getState();
    useUnreadStore.getState().markRead("nonexistent");
    // Should return same state reference (no unnecessary re-render)
    expect(useUnreadStore.getState().counts).toBe(before.counts);
  });

  it("marks all conversations as read", () => {
    useUnreadStore.getState().setCounts({ conv1: 5, conv2: 2 });
    useUnreadStore.getState().markAllRead();
    expect(useUnreadStore.getState().counts).toEqual({});
  });
});
