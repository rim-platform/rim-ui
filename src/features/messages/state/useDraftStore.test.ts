import { describe, it, expect, beforeEach } from "vitest";
import { useDraftStore } from "./useDraftStore";

describe("useDraftStore", () => {
  beforeEach(() => {
    useDraftStore.setState({ drafts: {} });
  });

  it("starts with empty drafts", () => {
    expect(useDraftStore.getState().drafts).toEqual({});
  });

  it("returns empty string for non-existent draft", () => {
    expect(useDraftStore.getState().getDraft("conv-1")).toBe("");
  });

  it("sets a draft for a conversation", () => {
    useDraftStore.getState().setDraft("conv-1", "Hello world");
    expect(useDraftStore.getState().getDraft("conv-1")).toBe("Hello world");
  });

  it("overwrites an existing draft", () => {
    useDraftStore.getState().setDraft("conv-1", "First");
    useDraftStore.getState().setDraft("conv-1", "Second");
    expect(useDraftStore.getState().getDraft("conv-1")).toBe("Second");
  });

  it("deletes draft when setting empty text", () => {
    useDraftStore.getState().setDraft("conv-1", "Some text");
    useDraftStore.getState().setDraft("conv-1", "");
    expect(useDraftStore.getState().drafts["conv-1"]).toBeUndefined();
  });

  it("clears a specific draft", () => {
    useDraftStore.getState().setDraft("conv-1", "Draft 1");
    useDraftStore.getState().setDraft("conv-2", "Draft 2");
    useDraftStore.getState().clearDraft("conv-1");
    expect(useDraftStore.getState().getDraft("conv-1")).toBe("");
    expect(useDraftStore.getState().getDraft("conv-2")).toBe("Draft 2");
  });

  it("clearDraft is a no-op for non-existent draft", () => {
    const before = useDraftStore.getState();
    useDraftStore.getState().clearDraft("nonexistent");
    // Should return same state reference
    expect(useDraftStore.getState().drafts).toBe(before.drafts);
  });

  it("manages multiple drafts independently", () => {
    useDraftStore.getState().setDraft("conv-1", "A");
    useDraftStore.getState().setDraft("conv-2", "B");
    useDraftStore.getState().setDraft("conv-3", "C");
    expect(useDraftStore.getState().getDraft("conv-1")).toBe("A");
    expect(useDraftStore.getState().getDraft("conv-2")).toBe("B");
    expect(useDraftStore.getState().getDraft("conv-3")).toBe("C");
  });
});
