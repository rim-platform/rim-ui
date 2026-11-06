import { afterEach, describe, it, expect, vi, beforeEach } from "vitest";

import { queryKeys } from "../../../core/query/keys";
import { queryClient } from "../../../core/query/queryClient";
import { useToastStore } from "../../../shared/toast";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useUnreadStore } from "../state/useUnreadStore";

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

import { MARK_ALL_UNDO_MS, markWorkspaceRead, sendPendingMarkAll } from "./useMarkAsRead";

const MARKER = "2026-11-06T10:00:00Z";

/** The workspaces `markAllAsRead` was sent for. */
function sent(): string[] {
  return requestMock.mock.calls
    .filter(([document]) => String(document).includes("markAllAsRead("))
    .map(([, variables]) => variables.input.workspaceId);
}

function undoAction() {
  const shown = useToastStore.getState().toasts.filter((t) => !t.dismissing && t.action);
  return shown[shown.length - 1]?.action ?? shown[0]?.action;
}

describe("markWorkspaceRead", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    requestMock.mockReset().mockResolvedValue({ markAllAsRead: true });
    useToastStore.setState({ toasts: [] });
    useAuthStore.setState({ session: { userId: "me" } } as never);
    useUnreadStore.setState({
      counts: {},
      spaceOf: {},
      markers: {},
      countSources: {},
      markAllPending: {},
      held: {},
    });
    useUnreadStore.getState().setCounts("ws-1", { a: 3 }, { a: MARKER });
    vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
  });

  afterEach(async () => {
    sendPendingMarkAll();
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("clears at once, offers Undo and sends only when the wait is over", async () => {
    markWorkspaceRead("ws-1");
    expect(useUnreadStore.getState().counts).toEqual({});
    expect(useUnreadStore.getState().markers).toEqual({});
    const [shown] = useToastStore.getState().toasts;
    expect(shown.title).toBe("All conversations marked as read");
    expect(shown.action?.label).toBe("Undo");
    expect(shown.duration).toBe(MARK_ALL_UNDO_MS);

    await vi.advanceTimersByTimeAsync(MARK_ALL_UNDO_MS - 1);
    expect(sent()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent()).toEqual(["ws-1"]);
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.unreadCounts("ws-1"),
    });
    expect(useUnreadStore.getState().markAllPending).toEqual({});
  });

  it("Undo restores counts and markers and sends nothing", async () => {
    markWorkspaceRead("ws-1");
    undoAction()?.onClick();
    expect(useUnreadStore.getState().counts).toEqual({ a: 3 });
    expect(useUnreadStore.getState().markers).toEqual({ a: MARKER });
    await vi.advanceTimersByTimeAsync(MARK_ALL_UNDO_MS * 2);
    expect(sent()).toEqual([]);
  });

  it("a read of the counts during the wait does not bring the badges back", async () => {
    markWorkspaceRead("ws-1");
    useUnreadStore.getState().setCounts("ws-1", { a: 3 }, { a: MARKER });
    expect(useUnreadStore.getState().counts).toEqual({});
    await vi.advanceTimersByTimeAsync(MARK_ALL_UNDO_MS);
    await vi.advanceTimersByTimeAsync(0);
    useUnreadStore.getState().setCounts("ws-1", { a: 1 }, { a: MARKER });
    expect(useUnreadStore.getState().counts).toEqual({ a: 1 });
  });

  it("a second run restarts the wait, and Undo restores both runs", async () => {
    markWorkspaceRead("ws-1");
    await vi.advanceTimersByTimeAsync(MARK_ALL_UNDO_MS - 1000);
    useUnreadStore.getState().increment("b", "ws-1");
    markWorkspaceRead("ws-1");
    expect(useUnreadStore.getState().counts).toEqual({});
    await vi.advanceTimersByTimeAsync(MARK_ALL_UNDO_MS - 1);
    expect(sent()).toEqual([]);
    undoAction()?.onClick();
    expect(useUnreadStore.getState().counts).toEqual({ a: 3, b: 1 });
    await vi.advanceTimersByTimeAsync(MARK_ALL_UNDO_MS * 2);
    expect(sent()).toEqual([]);
  });

  it("a second run in another workspace joins the same wait", async () => {
    useUnreadStore.getState().setCounts("ws-2", { c: 1 }, {});
    markWorkspaceRead("ws-1");
    await vi.advanceTimersByTimeAsync(1000);
    markWorkspaceRead("ws-2");
    await vi.advanceTimersByTimeAsync(MARK_ALL_UNDO_MS - 1);
    expect(sent()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent().sort()).toEqual(["ws-1", "ws-2"]);
  });

  it("a refused send says so and takes the counts back from the server", async () => {
    requestMock.mockRejectedValue(new Error("nope"));
    markWorkspaceRead("ws-1");
    await vi.advanceTimersByTimeAsync(MARK_ALL_UNDO_MS);
    await vi.advanceTimersByTimeAsync(0);
    expect(useToastStore.getState().toasts.map((t) => t.title)).toContain(
      "Failed to mark all as read",
    );
    expect(useUnreadStore.getState().markAllPending).toEqual({});
    expect(queryClient.invalidateQueries).toHaveBeenCalled();
  });

  it("sends nothing when the account changed during the wait", async () => {
    markWorkspaceRead("ws-1");
    useAuthStore.setState({ session: { userId: "someone-else" } } as never);
    await vi.advanceTimersByTimeAsync(MARK_ALL_UNDO_MS);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent()).toEqual([]);
    expect(useUnreadStore.getState().markAllPending).toEqual({});
  });
});

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
