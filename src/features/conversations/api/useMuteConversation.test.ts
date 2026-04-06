import { describe, it, expect, vi, beforeEach } from "vitest";
import { useMutedStore } from "../state/useMutedStore";

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: vi.fn(),
  },
}));

describe("useMuteConversation optimistic updates", () => {
  beforeEach(() => {
    useMutedStore.setState({ mutedIds: new Set() });
  });

  it("mute adds conversationId to mutedIds", () => {
    useMutedStore.getState().mute("conv-1");
    expect(useMutedStore.getState().mutedIds.has("conv-1")).toBe(true);
  });

  it("unmute removes conversationId from mutedIds", () => {
    useMutedStore.getState().mute("conv-1");
    useMutedStore.getState().unmute("conv-1");
    expect(useMutedStore.getState().mutedIds.has("conv-1")).toBe(false);
  });

  it("mute is idempotent", () => {
    useMutedStore.getState().mute("conv-1");
    useMutedStore.getState().mute("conv-1");
    expect(useMutedStore.getState().mutedIds.size).toBe(1);
  });

  it("unmute is a no-op for non-muted conversation", () => {
    useMutedStore.getState().unmute("conv-99");
    expect(useMutedStore.getState().mutedIds.size).toBe(0);
  });

  it("supports muting multiple conversations", () => {
    useMutedStore.getState().mute("conv-1");
    useMutedStore.getState().mute("conv-2");
    useMutedStore.getState().mute("conv-3");
    expect(useMutedStore.getState().mutedIds.size).toBe(3);
  });
});
