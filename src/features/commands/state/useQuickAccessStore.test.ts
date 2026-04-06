import { describe, it, expect, beforeEach } from "vitest";
import { useQuickAccessStore } from "./useQuickAccessStore";
import type { HoverTarget } from "../../../shell/state/useHoverContextStore";

describe("useQuickAccessStore", () => {
  beforeEach(() => {
    useQuickAccessStore.setState({ isOpen: false, target: null });
  });

  it("starts closed with no target", () => {
    const state = useQuickAccessStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.target).toBeNull();
  });

  it("opens with a channel target", () => {
    const target: HoverTarget = {
      kind: "channel",
      conversationId: "conv-1",
      serverId: "srv-1",
      label: "general",
    };
    useQuickAccessStore.getState().open(target);
    const state = useQuickAccessStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.target).toEqual(target);
  });

  it("opens with a workspace target", () => {
    const target: HoverTarget = {
      kind: "workspace",
      workspaceId: "ws-1",
      label: "My Workspace",
    };
    useQuickAccessStore.getState().open(target);
    expect(useQuickAccessStore.getState().target).toEqual(target);
  });

  it("closes and clears target", () => {
    const target: HoverTarget = {
      kind: "dm",
      conversationId: "conv-2",
      serverId: "srv-1",
      label: "John",
    };
    useQuickAccessStore.getState().open(target);
    useQuickAccessStore.getState().close();
    const state = useQuickAccessStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.target).toBeNull();
  });
});
