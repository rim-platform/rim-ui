import { beforeEach, describe, expect, it } from "vitest";

import { useAuthStore } from "../../auth/state/useAuthStore";
import { RECENT_ACTIVITY_LIMIT, useRecentActivityStore } from "./useRecentActivityStore";

function post(conversationId: string, threadId: string | null = null, at = 1, authorId = "u-2") {
  useRecentActivityStore.getState().record({
    workspaceId: "ws-1",
    conversationId,
    threadId,
    authorId,
    at,
  });
}

const ids = () => useRecentActivityStore.getState().entries.map((e) => e.conversationId);

describe("useRecentActivityStore", () => {
  beforeEach(() => {
    useRecentActivityStore.getState().reset();
    useAuthStore.setState({ session: { userId: "me" } });
  });

  it("keeps one entry per place and moves it to the front with the new time", () => {
    post("a", null, 1);
    post("b", null, 2);
    post("a", null, 3);
    expect(useRecentActivityStore.getState().entries).toEqual([
      { workspaceId: "ws-1", conversationId: "a", threadId: null, at: 3 },
      { workspaceId: "ws-1", conversationId: "b", threadId: null, at: 2 },
    ]);
  });

  it("tells a thread from its conversation", () => {
    post("a");
    post("a", "t-1");
    expect(useRecentActivityStore.getState().entries).toHaveLength(2);
  });

  it("keeps the newest 20", () => {
    for (let i = 0; i < RECENT_ACTIVITY_LIMIT + 5; i++) post(`c-${i}`);
    const entries = useRecentActivityStore.getState().entries;
    expect(entries).toHaveLength(RECENT_ACTIVITY_LIMIT);
    expect(entries[0].conversationId).toBe("c-24");
    expect(entries[19].conversationId).toBe("c-5");
  });

  it("skips the user's own messages", () => {
    post("a", null, 1, "me");
    expect(ids()).toEqual([]);
  });

  it("seeds after live entries and never over them", () => {
    post("live");
    useRecentActivityStore.getState().seed([
      { workspaceId: "ws-1", conversationId: "dm-1", threadId: null, at: 0 },
      { workspaceId: "ws-1", conversationId: "live", threadId: null, at: 0 },
    ]);
    expect(ids()).toEqual(["live", "dm-1"]);
    expect(useRecentActivityStore.getState().entries[0].at).toBe(1);
  });
});
