import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useShellStore } from "../state/useShellStore";
import { useOpenFirstChannelOnce } from "./useOpenFirstChannelOnce";

const facts = vi.hoisted(() => ({
  direct: false,
  items: [] as { id: string; isArchived: boolean }[],
}));
vi.mock("../../features/conversations/api/useChannels", () => ({
  useJoinedChannels: () => ({ data: { items: facts.items } }),
}));
vi.mock("../../features/relay/state/useRelayStore", () => ({
  useIsDirectSpace: () => facts.direct,
}));

const CHANNELS = [
  { id: "c-old", isArchived: true },
  { id: "c-general", isArchived: false },
  { id: "c-random", isArchived: false },
];

describe("opening the first channel after sign-up", () => {
  beforeEach(() => {
    facts.direct = false;
    facts.items = CHANNELS;
    useShellStore.getState().reset();
  });

  it("opens the first channel under Channels once and clears the flag", () => {
    useShellStore.getState().setOpenFirstChannelOnce(true);
    renderHook(() => useOpenFirstChannelOnce("ws-1"));
    expect(useShellStore.getState().selectedConversationId).toBe("c-general");
    expect(useShellStore.getState().openFirstChannelOnce).toBe(false);
  });

  it("opens nothing on a later switch with nothing selected", () => {
    useShellStore.getState().setOpenFirstChannelOnce(true);
    const { rerender } = renderHook(({ id }) => useOpenFirstChannelOnce(id), {
      initialProps: { id: "ws-1" },
    });
    act(() => useShellStore.getState().setSelectedConversationId(null));
    rerender({ id: "ws-2" });
    expect(useShellStore.getState().selectedConversationId).toBeNull();
  });

  it("opens nothing on a sign-in, which sets no flag", () => {
    renderHook(() => useOpenFirstChannelOnce("ws-1"));
    expect(useShellStore.getState().selectedConversationId).toBeNull();
  });

  it("waits for a channel to load", () => {
    facts.items = [];
    useShellStore.getState().setOpenFirstChannelOnce(true);
    const { rerender } = renderHook(() => useOpenFirstChannelOnce("ws-1"));
    expect(useShellStore.getState().selectedConversationId).toBeNull();
    expect(useShellStore.getState().openFirstChannelOnce).toBe(true);
    facts.items = CHANNELS;
    rerender();
    expect(useShellStore.getState().selectedConversationId).toBe("c-general");
  });

  it("opens nothing and keeps the flag in a direct space", () => {
    facts.direct = true;
    useShellStore.getState().setOpenFirstChannelOnce(true);
    renderHook(() => useOpenFirstChannelOnce("direct-1"));
    expect(useShellStore.getState().selectedConversationId).toBeNull();
    expect(useShellStore.getState().openFirstChannelOnce).toBe(true);
  });

  it("drops the flag when the person picks a conversation first", () => {
    useShellStore.getState().setOpenFirstChannelOnce(true);
    useShellStore.getState().setSelectedConversationId("c-mine");
    renderHook(() => useOpenFirstChannelOnce("ws-1"));
    expect(useShellStore.getState().selectedConversationId).toBe("c-mine");
    expect(useShellStore.getState().openFirstChannelOnce).toBe(false);
  });
});
