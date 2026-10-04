import { describe, it, expect, beforeEach } from "vitest";
import { useMutedStore } from "./useMutedStore";

describe("useMutedStore", () => {
  beforeEach(() => {
    useMutedStore.setState({ mutedIds: new Set() });
  });

  it("starts with no muted conversations", () => {
    expect(useMutedStore.getState().mutedIds.size).toBe(0);
  });

  it("mutes a conversation", () => {
    useMutedStore.getState().mute("conv-1");
    expect(useMutedStore.getState().isMuted("conv-1")).toBe(true);
  });

  it("unmutes a conversation", () => {
    useMutedStore.getState().mute("conv-1");
    useMutedStore.getState().unmute("conv-1");
    expect(useMutedStore.getState().isMuted("conv-1")).toBe(false);
  });

  it("isMuted returns false for non-muted conversation", () => {
    expect(useMutedStore.getState().isMuted("conv-unknown")).toBe(false);
  });

  it("muting the same conversation twice is idempotent", () => {
    useMutedStore.getState().mute("conv-1");
    useMutedStore.getState().mute("conv-1");
    expect(useMutedStore.getState().mutedIds.size).toBe(1);
  });

  it("sets muted ids in bulk from an array", () => {
    useMutedStore.getState().setMutedIds(["conv-1", "conv-2", "conv-3"]);
    expect(useMutedStore.getState().isMuted("conv-1")).toBe(true);
    expect(useMutedStore.getState().isMuted("conv-2")).toBe(true);
    expect(useMutedStore.getState().isMuted("conv-3")).toBe(true);
    expect(useMutedStore.getState().mutedIds.size).toBe(3);
  });

  it("setMutedIds replaces existing muted set", () => {
    useMutedStore.getState().mute("old-conv");
    useMutedStore.getState().setMutedIds(["new-conv"]);
    expect(useMutedStore.getState().isMuted("old-conv")).toBe(false);
    expect(useMutedStore.getState().isMuted("new-conv")).toBe(true);
  });
});
