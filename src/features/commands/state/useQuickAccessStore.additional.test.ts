import { describe, it, expect, beforeEach } from "vitest";
import { useQuickAccessStore } from "./useQuickAccessStore";
import type { HoverTarget } from "../../../shell/state/useHoverContextStore";

const channelTarget: HoverTarget = {
  kind: "channel",
  conversationId: "conv-1",
  serverId: "ws-1",
  label: "#general",
};

const dmTarget: HoverTarget = {
  kind: "dm",
  conversationId: "conv-2",
  serverId: "ws-1",
  label: "Alice",
};

describe("useQuickAccessStore — additional", () => {
  beforeEach(() => {
    useQuickAccessStore.setState({ isOpen: false, target: null });
  });

  it("starts closed with no target", () => {
    const state = useQuickAccessStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.target).toBeNull();
  });

  it("open sets isOpen and target", () => {
    useQuickAccessStore.getState().open(channelTarget);
    const state = useQuickAccessStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.target).toEqual(channelTarget);
  });

  it("close resets state", () => {
    useQuickAccessStore.getState().open(channelTarget);
    useQuickAccessStore.getState().close();
    const state = useQuickAccessStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.target).toBeNull();
  });

  it("open with different target overwrites previous", () => {
    useQuickAccessStore.getState().open(channelTarget);
    useQuickAccessStore.getState().open(dmTarget);
    expect(useQuickAccessStore.getState().target).toEqual(dmTarget);
  });
});
