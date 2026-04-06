import { describe, it, expect, beforeEach } from "vitest";
import { useHoverContextStore } from "./useHoverContextStore";
import type { HoverTarget } from "./useHoverContextStore";

describe("useHoverContextStore", () => {
  beforeEach(() => {
    useHoverContextStore.setState({ target: null });
  });

  it("starts with null target", () => {
    expect(useHoverContextStore.getState().target).toBeNull();
  });

  it("sets a channel target", () => {
    const target: HoverTarget = {
      kind: "channel",
      conversationId: "conv-1",
      serverId: "srv-1",
      label: "general",
    };
    useHoverContextStore.getState().setTarget(target);
    expect(useHoverContextStore.getState().target).toEqual(target);
  });

  it("sets a dm target", () => {
    const target: HoverTarget = {
      kind: "dm",
      conversationId: "conv-2",
      serverId: "srv-1",
      label: "Alice",
    };
    useHoverContextStore.getState().setTarget(target);
    expect(useHoverContextStore.getState().target).toEqual(target);
  });

  it("sets a workspace target", () => {
    const target: HoverTarget = {
      kind: "workspace",
      workspaceId: "ws-1",
      label: "RIM HQ",
    };
    useHoverContextStore.getState().setTarget(target);
    expect(useHoverContextStore.getState().target).toEqual(target);
  });

  it("clears the target", () => {
    useHoverContextStore.getState().setTarget({
      kind: "channel",
      conversationId: "conv-1",
      serverId: "srv-1",
      label: "general",
    });
    useHoverContextStore.getState().clear();
    expect(useHoverContextStore.getState().target).toBeNull();
  });

  it("overwrites existing target", () => {
    useHoverContextStore.getState().setTarget({
      kind: "channel",
      conversationId: "conv-1",
      serverId: "srv-1",
      label: "general",
    });
    const newTarget: HoverTarget = {
      kind: "workspace",
      workspaceId: "ws-2",
      label: "Other",
    };
    useHoverContextStore.getState().setTarget(newTarget);
    expect(useHoverContextStore.getState().target).toEqual(newTarget);
  });
});
