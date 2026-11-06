import { describe, it, expect, beforeEach } from "vitest";
import { unreadTotal, useUnreadStore } from "./useUnreadStore";

describe("useUnreadStore", () => {
  beforeEach(() => {
    useUnreadStore.setState({ counts: {}, spaceOf: {}, markers: {}, countSources: {} });
  });

  it("keeps a space's markers with its counts and says where the counts came from", () => {
    const store = useUnreadStore.getState();
    store.setCounts("with", { a: 1 }, { a: "2026-11-06T10:00:00Z" });
    store.setCounts("without", { b: 2 });
    const state = useUnreadStore.getState();
    expect(state.markers).toEqual({ a: "2026-11-06T10:00:00Z" });
    expect(state.countSources).toEqual({ with: "markers", without: "plain" });
  });

  it("replaces one space's markers and keeps the other spaces'", () => {
    const store = useUnreadStore.getState();
    store.setCounts("one", { a: 1 }, { a: "2026-11-06T10:00:00Z" });
    store.setCounts("two", { b: 1 }, { b: "2026-11-06T11:00:00Z" });
    store.setCounts("one", {}, {});
    expect(useUnreadStore.getState().markers).toEqual({ b: "2026-11-06T11:00:00Z" });
  });

  it("clears a conversation's marker when it is marked read", () => {
    const store = useUnreadStore.getState();
    store.setCounts("ws", { a: 1, b: 1 }, { a: "2026-11-06T10:00:00Z", b: "2026-11-06T11:00:00Z" });
    store.markRead("a");
    expect(useUnreadStore.getState().markers).toEqual({ b: "2026-11-06T11:00:00Z" });
  });

  it("clears a space's markers when all of it is marked read", () => {
    const store = useUnreadStore.getState();
    store.setCounts("one", { a: 1 }, { a: "2026-11-06T10:00:00Z" });
    store.setCounts("two", { b: 1 }, { b: "2026-11-06T11:00:00Z" });
    store.markAllRead("one");
    expect(useUnreadStore.getState().markers).toEqual({ b: "2026-11-06T11:00:00Z" });
  });

  it("starts with empty counts", () => {
    expect(useUnreadStore.getState().counts).toEqual({});
  });

  it("sets counts from a bulk update", () => {
    useUnreadStore.getState().setCounts("ws", { conv1: 3, conv2: 1 });
    expect(useUnreadStore.getState().counts).toEqual({ conv1: 3, conv2: 1 });
  });

  it("replaces one space's counts and keeps the other spaces'", () => {
    const store = useUnreadStore.getState();
    store.setCounts("ws", { conv1: 3, conv2: 1 });
    store.setCounts("dm", { dm1: 2 });
    useUnreadStore.getState().setCounts("ws", { conv2: 4 });
    expect(useUnreadStore.getState().counts).toEqual({ conv2: 4, dm1: 2 });
  });

  it("increments count for a conversation", () => {
    useUnreadStore.getState().increment("conv1", "ws");
    expect(useUnreadStore.getState().counts["conv1"]).toBe(1);
    useUnreadStore.getState().increment("conv1", "ws");
    expect(useUnreadStore.getState().counts["conv1"]).toBe(2);
  });

  it("increments from zero for unknown conversation", () => {
    useUnreadStore.getState().increment("unknown", "ws");
    expect(useUnreadStore.getState().counts["unknown"]).toBe(1);
  });

  it("marks a conversation as read", () => {
    useUnreadStore.getState().setCounts("ws", { conv1: 5, conv2: 2 });
    useUnreadStore.getState().markRead("conv1");
    expect(useUnreadStore.getState().counts["conv1"]).toBeUndefined();
    expect(useUnreadStore.getState().counts["conv2"]).toBe(2);
  });

  it("forgets a read conversation's space, so no total counts it", () => {
    useUnreadStore.getState().setCounts("ws", { conv1: 5 });
    useUnreadStore.getState().markRead("conv1");
    const { counts, spaceOf } = useUnreadStore.getState();
    expect(spaceOf).toEqual({});
    expect(unreadTotal(counts, spaceOf, (space) => space === "ws")).toBe(0);
  });

  it("markRead is a no-op for already-read conversations", () => {
    const before = useUnreadStore.getState();
    useUnreadStore.getState().markRead("nonexistent");
    // Should return same state reference (no unnecessary re-render)
    expect(useUnreadStore.getState().counts).toBe(before.counts);
  });

  it("marks all conversations of one space as read", () => {
    useUnreadStore.getState().setCounts("ws", { conv1: 5, conv2: 2 });
    useUnreadStore.getState().increment("dm1", "dm");
    useUnreadStore.getState().markAllRead("ws");
    expect(useUnreadStore.getState().counts).toEqual({ dm1: 1 });
  });

  it("totals the unread messages of the spaces asked for", () => {
    useUnreadStore.getState().setCounts("ws", { conv1: 5 });
    useUnreadStore.getState().setCounts("dm", { dm1: 2 });
    useUnreadStore.getState().increment("dm2", "dm");
    const { counts, spaceOf } = useUnreadStore.getState();
    expect(unreadTotal(counts, spaceOf, (space) => space === "dm")).toBe(3);
    expect(unreadTotal(counts, spaceOf, (space) => space === "ws")).toBe(5);
  });
});
