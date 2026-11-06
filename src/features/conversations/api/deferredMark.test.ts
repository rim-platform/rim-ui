import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { queryKeys } from "../../../core/query/keys";
import { queryClient } from "../../../core/query/queryClient";
import { useToastStore } from "../../../shared/toast";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useUnreadStore } from "../state/useUnreadStore";

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));

import {
  deferMark,
  sendDeferredMark,
  undoDeferredMark,
  undoLatestDeferredMark,
  useDeferredMarks,
  type DeferredTarget,
} from "./deferredMark";

const WAIT = 10_000;
const READ_AT = "2026-11-06T10:00:00.123456+00:00";
const MARKER = "2026-11-06T09:00:00Z";

function conversation(conversationId: string, remaining = 0): DeferredTarget {
  return { kind: "conversation", workspaceId: "ws-1", conversationId, readAt: READ_AT, remaining };
}

/** The `input` of every `markAsRead` sent. */
function sent() {
  return requestMock.mock.calls
    .filter(([document]) => String(document).includes("markAsRead("))
    .map(([, variables]) => variables.input);
}

beforeEach(() => {
  vi.useFakeTimers();
  requestMock.mockReset().mockResolvedValue({ markAsRead: true });
  useToastStore.setState({ toasts: [] });
  useAuthStore.setState({ session: { userId: "me" } } as never);
  useUnreadStore.setState({
    counts: {},
    spaceOf: {},
    markers: {},
    countSources: {},
    markAllPending: {},
    conversationMarks: {},
    held: {},
  });
  useUnreadStore.getState().setCounts("ws-1", { a: 3, b: 2 }, { a: MARKER, b: MARKER });
  vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
});

afterEach(async () => {
  while (undoLatestDeferredMark());
  await vi.runAllTimersAsync();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("a deferred mark of a conversation", () => {
  it("clears it at once and tells the server up to its time when the wait is over", async () => {
    deferMark({ targets: [conversation("a")], waitMs: WAIT });
    expect(useUnreadStore.getState().counts).toEqual({ b: 2 });
    await vi.advanceTimersByTimeAsync(WAIT - 1);
    expect(sent()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent()).toEqual([{ conversationId: "a", workspaceId: "ws-1", readAt: READ_AT }]);
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.unreadCounts("ws-1"),
    });
    expect(useUnreadStore.getState().conversationMarks).toEqual({});
  });

  it("keeps what is newer than its time, from there on", () => {
    deferMark({ targets: [conversation("a", 1)], waitMs: WAIT });
    const state = useUnreadStore.getState();
    expect(state.counts.a).toBe(1);
    expect(state.markers.a).toBe(READ_AT);
  });

  it("Undo restores count and marker and sends nothing", async () => {
    const id = deferMark({ targets: [conversation("a", 1)], waitMs: WAIT });
    undoDeferredMark(id);
    const state = useUnreadStore.getState();
    expect(state.counts.a).toBe(3);
    expect(state.markers.a).toBe(MARKER);
    await vi.advanceTimersByTimeAsync(WAIT * 2);
    expect(sent()).toEqual([]);
  });

  it("Undo keeps what arrived during the wait", () => {
    const id = deferMark({ targets: [conversation("a")], waitMs: WAIT });
    useUnreadStore.getState().increment("a", "ws-1");
    undoDeferredMark(id);
    expect(useUnreadStore.getState().counts.a).toBe(4);
  });

  it("a read of the counts during the wait changes nothing of it, and the rest as usual", () => {
    deferMark({ targets: [conversation("a", 1)], waitMs: WAIT });
    useUnreadStore.getState().increment("a", "ws-1");
    useUnreadStore.getState().setCounts("ws-1", { a: 3, b: 7 }, { a: MARKER, b: MARKER });
    const state = useUnreadStore.getState();
    expect(state.counts).toEqual({ a: 2, b: 7 });
    expect(state.markers.a).toBe(READ_AT);
  });

  it("publishes what is waiting, with each conversation's space", () => {
    const id = deferMark({ targets: [conversation("a")], waitMs: WAIT });
    expect(useDeferredMarks.getState().marks).toEqual([
      { id, conversations: [{ conversationId: "a", workspaceId: "ws-1" }] },
    ]);
    undoDeferredMark(id);
    expect(useDeferredMarks.getState().marks).toEqual([]);
  });

  it("sends nothing when the account changed during the wait", async () => {
    deferMark({ targets: [conversation("a")], waitMs: WAIT });
    useAuthStore.setState({ session: { userId: "someone-else" } } as never);
    await vi.advanceTimersByTimeAsync(WAIT);
    expect(sent()).toEqual([]);
  });
});

describe("a deferred mark of several", () => {
  it("has one Undo for all of them", async () => {
    deferMark({
      targets: [conversation("a"), conversation("b")],
      waitMs: WAIT,
      toastTitle: "2 conversations marked as read",
    });
    expect(useUnreadStore.getState().counts).toEqual({});
    const [shown] = useToastStore.getState().toasts;
    expect(shown.title).toBe("2 conversations marked as read");
    expect(shown.duration).toBe(WAIT);
    shown.action?.onClick();
    expect(useUnreadStore.getState().counts).toEqual({ a: 3, b: 2 });
    await vi.advanceTimersByTimeAsync(WAIT * 2);
    expect(sent()).toEqual([]);
  });

  it("sends one call for each, and says how many were refused", async () => {
    requestMock.mockImplementation(async (_document, variables) => {
      if (variables.input.conversationId === "b") throw new Error("no");
      return { markAsRead: true };
    });
    deferMark({ targets: [conversation("a"), conversation("b")], waitMs: WAIT });
    await vi.advanceTimersByTimeAsync(WAIT);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent()).toHaveLength(2);
    expect(useToastStore.getState().toasts.map((t) => t.title)).toContain(
      "1 of 2 conversations could not be marked read and stay unread",
    );
  });

  it("waits out a rate limit for as long as the server says, then goes on", async () => {
    const limited = Object.assign(new Error("slow down"), {
      response: {
        errors: [{ extensions: { code: "RATE_LIMITED", retryAfterSeconds: 3 } }],
      },
    });
    requestMock.mockRejectedValueOnce(limited).mockResolvedValue({ markAsRead: true });
    deferMark({ targets: [conversation("a")], waitMs: WAIT });
    await vi.advanceTimersByTimeAsync(WAIT);
    expect(sent()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2999);
    expect(sent()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent()).toHaveLength(2);
    expect(useToastStore.getState().toasts.some((t) => t.variant === "error")).toBe(false);
  });

  it("sends the first 60 at once and slows down past them, staying marked here", async () => {
    const many = Array.from({ length: 70 }, (_, i) => conversation(`c-${i}`));
    deferMark({ targets: many, waitMs: WAIT });
    await vi.advanceTimersByTimeAsync(WAIT);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent()).toHaveLength(60);
    expect(Object.keys(useUnreadStore.getState().conversationMarks)).toHaveLength(10);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sent()).toHaveLength(70);
    expect(useUnreadStore.getState().conversationMarks).toEqual({});
  });
});

describe("marks side by side", () => {
  it("Undo takes back the newest first", () => {
    deferMark({ targets: [conversation("a")], waitMs: WAIT });
    deferMark({ targets: [conversation("b")], waitMs: WAIT });
    expect(undoLatestDeferredMark()).toBe(true);
    expect(useUnreadStore.getState().counts).toEqual({ b: 2 });
    expect(undoLatestDeferredMark()).toBe(true);
    expect(useUnreadStore.getState().counts).toEqual({ a: 3, b: 2 });
    expect(undoLatestDeferredMark()).toBe(false);
  });

  it("sending one leaves the other waiting", async () => {
    const first = deferMark({ targets: [conversation("a")], waitMs: WAIT });
    deferMark({ targets: [conversation("b")], waitMs: WAIT });
    sendDeferredMark(first);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent().map((input) => input.conversationId)).toEqual(["a"]);
    expect(useDeferredMarks.getState().marks).toHaveLength(1);
  });
});
