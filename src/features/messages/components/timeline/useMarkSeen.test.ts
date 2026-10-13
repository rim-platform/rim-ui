import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { TestProviders } from "../../../../test/utils";
import { useUnreadStore } from "../../../conversations/state/useUnreadStore";

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("../../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));

import { MARK_SEEN_DELAY_MS, useMarkSeen } from "./useMarkSeen";

interface Item {
  sentAt: string;
  authorId: string;
}

/** A message from `authorId` sent `minute` minutes into the day. */
function message(minute: number, authorId = "bob"): Item {
  return { sentAt: new Date(Date.UTC(2026, 9, 13, 10, minute)).toISOString(), authorId };
}

interface Props {
  conversationId: string;
  items: Item[];
}

const atBottom = { current: true };

function renderMarkSeen(initial: Props) {
  return renderHook(
    ({ conversationId, items }: Props) =>
      useMarkSeen({
        workspaceId: "ws-1",
        conversationId,
        items,
        isLensActive: false,
        currentUserId: "me",
        isAtBottomRef: atBottom,
      }),
    { initialProps: initial, wrapper: TestProviders },
  );
}

/** The `readAt` of every `markAsRead` sent, with its conversation. */
function marks(): { conversationId: string; readAt: string }[] {
  return requestMock.mock.calls
    .filter(([document]) => String(document).includes("markAsRead("))
    .map(([, variables]) => ({
      conversationId: variables.input.conversationId,
      readAt: variables.input.readAt,
    }));
}

async function wait(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

const history = [message(0, "alice"), message(1)];

beforeEach(() => {
  vi.useFakeTimers();
  requestMock.mockReset();
  requestMock.mockResolvedValue({ markAsRead: true });
  atBottom.current = true;
  useUnreadStore.setState({ counts: {}, spaceOf: {} });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useMarkSeen", () => {
  it("marks an unread conversation read up to its newest message once it opens at the bottom", async () => {
    useUnreadStore.getState().setCounts("ws-1", { "conv-1": 2 });
    renderMarkSeen({ conversationId: "conv-1", items: history });

    await wait(MARK_SEEN_DELAY_MS - 1);
    expect(marks()).toEqual([]);
    await wait(1);
    expect(marks()).toEqual([{ conversationId: "conv-1", readAt: history[1].sentAt }]);
    expect(useUnreadStore.getState().counts).toEqual({});
  });

  it("waits while the viewer is scrolled up and drops the wait when they scroll away", async () => {
    useUnreadStore.getState().setCounts("ws-1", { "conv-1": 2 });
    atBottom.current = false;
    const { result } = renderMarkSeen({ conversationId: "conv-1", items: history });
    await wait(MARK_SEEN_DELAY_MS * 2);
    expect(marks()).toEqual([]);

    act(() => result.current.onScrollPosition(true));
    await wait(MARK_SEEN_DELAY_MS / 2);
    act(() => result.current.onScrollPosition(false));
    await wait(MARK_SEEN_DELAY_MS * 2);
    expect(marks()).toEqual([]);

    act(() => result.current.onScrollPosition(true));
    await wait(MARK_SEEN_DELAY_MS);
    expect(marks()).toEqual([{ conversationId: "conv-1", readAt: history[1].sentAt }]);
  });

  it("waits while the page is hidden and marks once it is shown at the bottom", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const { rerender } = renderMarkSeen({ conversationId: "conv-1", items: history });
    rerender({ conversationId: "conv-1", items: [...history, message(2)] });
    await wait(MARK_SEEN_DELAY_MS * 2);
    expect(marks()).toEqual([]);

    visibility.mockReturnValue("visible");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await wait(MARK_SEEN_DELAY_MS);
    expect(marks()).toEqual([{ conversationId: "conv-1", readAt: message(2).sentAt }]);
    visibility.mockRestore();
  });

  it("sends nothing for a read conversation, nor for the viewer's own new message", async () => {
    const { rerender } = renderMarkSeen({ conversationId: "conv-1", items: history });
    rerender({ conversationId: "conv-1", items: [...history, message(2, "me")] });
    await wait(MARK_SEEN_DELAY_MS * 2);
    expect(marks()).toEqual([]);
  });

  it("marks a burst of new messages at the bottom once, up to the newest", async () => {
    const { rerender } = renderMarkSeen({ conversationId: "conv-1", items: history });
    const burst = [...history, message(2), message(3, "alice")];
    rerender({ conversationId: "conv-1", items: burst.slice(0, 3) });
    await wait(MARK_SEEN_DELAY_MS / 2);
    rerender({ conversationId: "conv-1", items: burst });
    await wait(MARK_SEEN_DELAY_MS);
    expect(marks()).toEqual([{ conversationId: "conv-1", readAt: burst[3].sentAt }]);
  });

  it("marks again when a newer message arrives at the bottom", async () => {
    useUnreadStore.getState().setCounts("ws-1", { "conv-1": 2 });
    const { rerender } = renderMarkSeen({ conversationId: "conv-1", items: history });
    await wait(MARK_SEEN_DELAY_MS);
    const later = [...history, message(5)];
    rerender({ conversationId: "conv-1", items: later });
    await wait(MARK_SEEN_DELAY_MS);
    expect(marks()).toEqual([
      { conversationId: "conv-1", readAt: history[1].sentAt },
      { conversationId: "conv-1", readAt: later[2].sentAt },
    ]);
  });

  it("sends a pending mark at once when the viewer leaves the conversation", async () => {
    useUnreadStore.getState().setCounts("ws-1", { "conv-1": 2 });
    const { rerender } = renderMarkSeen({ conversationId: "conv-1", items: history });
    await wait(MARK_SEEN_DELAY_MS / 2);
    rerender({ conversationId: "conv-2", items: [message(7)] });
    await wait(0);
    expect(marks()).toEqual([{ conversationId: "conv-1", readAt: history[1].sentAt }]);
    await wait(MARK_SEEN_DELAY_MS * 2);
    expect(marks()).toHaveLength(1);
  });
});
