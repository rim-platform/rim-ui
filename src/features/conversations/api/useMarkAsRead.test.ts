import { describe, it, expect, vi, beforeEach } from "vitest";
import { useUnreadStore } from "../state/useUnreadStore";

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: vi.fn(),
  },
}));

describe("useMarkAsRead - optimistic unread store update", () => {
  beforeEach(() => {
    useUnreadStore.setState({ counts: { "conv-1": 5, "conv-2": 3 } });
  });

  it("markRead clears the unread count for a conversation", () => {
    useUnreadStore.getState().markRead("conv-1");
    expect(useUnreadStore.getState().counts["conv-1"]).toBeUndefined();
    // Other conversations are not affected
    expect(useUnreadStore.getState().counts["conv-2"]).toBe(3);
  });

  it("markRead is a no-op for already-read conversations", () => {
    const before = useUnreadStore.getState().counts;
    useUnreadStore.getState().markRead("conv-99");
    // Should not crash, state unchanged for existing entries
    expect(useUnreadStore.getState().counts["conv-1"]).toBe(before["conv-1"]);
  });
});
