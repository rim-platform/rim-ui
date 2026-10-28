import { beforeEach, describe, expect, it, vi } from "vitest";

import { useBlockedConversations } from "../../relay/state/useBlockedConversations";
import { useUnreadStore } from "../state/useUnreadStore";

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));

import { fetchUnreadCounts } from "./useUnreadCounts";

beforeEach(() => {
  requestMock.mockReset().mockResolvedValue({
    unreadCounts: [
      { conversationId: "c-hidden", count: 4 },
      { conversationId: "c-other", count: 2 },
    ],
  });
  useUnreadStore.setState({ counts: {}, spaceOf: {} });
  useBlockedConversations.getState().reset();
});

describe("fetchUnreadCounts", () => {
  it("leaves hidden conversations out of a space's unread counts", async () => {
    useBlockedConversations.getState().setIn("remote-direct", { "c-hidden": "rimp1_alice" });
    const items = await fetchUnreadCounts("remote-direct");
    expect(items).toEqual([{ conversationId: "c-other", count: 2 }]);
    expect(useUnreadStore.getState().counts).toEqual({ "c-other": 2 });
  });
});
