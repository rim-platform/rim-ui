import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { queryKeys } from "../../../../core/query/keys";
import { useUnreadStore } from "../../../conversations/state/useUnreadStore";
import { useMessageDisplaySettingsStore } from "../../state/useMessageDisplaySettingsStore";

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("../../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));

import { MAX_EXTRA_PAGES_TO_MARKER, useNewMessagesDivider } from "./useNewMessagesDivider";

/** A message sent `minute` minutes into the day. */
function message(minute: number) {
  return { sentAt: new Date(Date.UTC(2026, 10, 6, 10, minute)).toISOString() };
}

const items = [message(0), message(1), message(2), message(3)];
const atBottom = { current: true };
const fetchNextPage = vi.fn();
let queryClient: QueryClient;

interface Props {
  conversationId: string;
  items: { sentAt: string }[];
  firstPagePending: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
}

function renderDivider(overrides: Partial<Props> = {}) {
  const initialProps: Props = {
    conversationId: "conv-1",
    items,
    firstPagePending: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    ...overrides,
  };
  return renderHook(
    (props: Props) =>
      useNewMessagesDivider({
        workspaceId: "ws-1",
        isLensActive: false,
        isAtBottomRef: atBottom,
        fetchNextPage,
        ...props,
      }),
    {
      initialProps,
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client: queryClient }, children),
    },
  );
}

/** The `readAt` of every `markAsRead` sent. */
function marks(): string[] {
  return requestMock.mock.calls
    .filter(([document]) => String(document).includes("markAsRead("))
    .map(([, variables]) => variables.input.readAt);
}

async function wait(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

beforeEach(() => {
  vi.useFakeTimers();
  queryClient = new QueryClient();
  requestMock.mockReset();
  requestMock.mockResolvedValue({ markAsRead: true });
  fetchNextPage.mockReset();
  useUnreadStore.setState({
    counts: {},
    spaceOf: {},
    markers: {},
    countSources: { "ws-1": "markers" },
    watermarks: {},
  });
  useMessageDisplaySettingsStore.setState({ markReadByHand: false });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useNewMessagesDivider: the line", () => {
  it("is the marker while the conversation counts as unread, over a watermark", () => {
    useUnreadStore.setState({ watermarks: { "conv-1": items[2].sentAt } });
    useUnreadStore.getState().setCounts("ws-1", { "conv-1": 2 }, { "conv-1": items[0].sentAt });
    const { result } = renderDivider();
    expect(result.current.firstNewIndex).toBe(1);
  });

  it("stays where the marker put it once the conversation is marked read", () => {
    useUnreadStore.getState().setCounts("ws-1", { "conv-1": 2 }, { "conv-1": items[0].sentAt });
    const { result } = renderDivider();
    act(() => useUnreadStore.getState().markRead("conv-1"));
    expect(result.current.firstNewIndex).toBe(1);
  });

  it("is the watermark for a conversation already read", () => {
    useUnreadStore.setState({ watermarks: { "conv-1": items[2].sentAt } });
    useUnreadStore.getState().setCounts("ws-1", {}, {});
    const { result } = renderDivider();
    expect(result.current.firstNewIndex).toBe(3);
  });

  it("is the watermark on a host without markers, whatever the count says", () => {
    useUnreadStore.setState({ watermarks: { "conv-1": items[1].sentAt } });
    useUnreadStore.getState().setCounts("ws-1", { "conv-1": 9 });
    const { result } = renderDivider();
    expect(result.current.firstNewIndex).toBe(2);
    expect(result.current.awaitingFirstNew).toBe(false);
    expect(fetchNextPage).not.toHaveBeenCalled();
  });

  it("does not take a message within the marker's millisecond for read", () => {
    const sent = "2026-11-06T10:00:00.123456+00:00";
    useUnreadStore
      .getState()
      .setCounts("ws-1", { "conv-1": 1 }, { "conv-1": "2026-11-06T10:00:00.123455+00:00" });
    const { result } = renderDivider({ items: [{ sentAt: sent }] });
    expect(result.current.firstNewIndex).toBe(0);
  });
});

describe("useNewMessagesDivider: waiting for the marker", () => {
  it("waits while the counts have not answered and no longer than the first page took", async () => {
    useUnreadStore.setState({ countSources: {} });
    const { result, rerender } = renderDivider({ firstPagePending: true, items: [] });
    expect(result.current.awaitingFirstNew).toBe(true);

    await wait(300);
    const loaded = {
      conversationId: "conv-1",
      items,
      firstPagePending: false,
      hasNextPage: false,
      isFetchingNextPage: false,
    };
    rerender(loaded);
    expect(result.current.awaitingFirstNew).toBe(true);
    await wait(299);
    expect(result.current.awaitingFirstNew).toBe(true);
    await wait(1);
    expect(result.current.awaitingFirstNew).toBe(false);
    expect(result.current.firstNewKnown).toBe(false);

    act(() => useUnreadStore.getState().setCounts("ws-1", {}, {}));
    expect(result.current.firstNewKnown).toBe(true);
  });

  it("stops waiting as soon as the counts answer", () => {
    useUnreadStore.setState({ countSources: {} });
    const { result } = renderDivider();
    expect(result.current.awaitingFirstNew).toBe(true);
    act(() =>
      useUnreadStore.getState().setCounts("ws-1", { "conv-1": 1 }, { "conv-1": items[2].sentAt }),
    );
    expect(result.current.awaitingFirstNew).toBe(false);
    expect(result.current.firstNewIndex).toBe(3);
  });

  it("reads the counts again, once, for a live count with no marker", () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    useUnreadStore.getState().setCounts("ws-1", {}, {});
    useUnreadStore.getState().increment("conv-1", "ws-1");
    const { result, rerender } = renderDivider();
    expect(result.current.awaitingFirstNew).toBe(true);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.unreadCounts("ws-1") });

    rerender({
      conversationId: "conv-1",
      items: [...items],
      firstPagePending: false,
      hasNextPage: false,
      isFetchingNextPage: false,
    });
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});

describe("useNewMessagesDivider: older pages", () => {
  const unreadFromBefore = () =>
    useUnreadStore
      .getState()
      .setCounts("ws-1", { "conv-1": 200 }, { "conv-1": "2026-01-01T00:00:00Z" });

  it("loads older pages until the marker, at most the limit, then says more is above", async () => {
    unreadFromBefore();
    const props = {
      conversationId: "conv-1",
      items,
      firstPagePending: false,
      hasNextPage: true,
      isFetchingNextPage: false,
    };
    const { result, rerender } = renderDivider(props);
    for (let page = 1; page <= MAX_EXTRA_PAGES_TO_MARKER; page++) {
      expect(fetchNextPage).toHaveBeenCalledTimes(page);
      rerender({ ...props, isFetchingNextPage: true });
      await wait(0);
      rerender({ ...props, items: [...props.items] });
      await wait(0);
    }
    expect(fetchNextPage).toHaveBeenCalledTimes(MAX_EXTRA_PAGES_TO_MARKER);
    expect(result.current.awaitingFirstNew).toBe(false);
    expect(result.current.firstNewIndex).toBe(0);
    expect(result.current.moreAbove).toBe(true);
  });

  it("does not claim more above when nothing older remains", () => {
    unreadFromBefore();
    const { result } = renderDivider({ hasNextPage: false });
    expect(result.current.firstNewIndex).toBe(0);
    expect(result.current.moreAbove).toBe(false);
    expect(fetchNextPage).not.toHaveBeenCalled();
  });

  it("stops loading once the marker is among the loaded messages", () => {
    useUnreadStore.getState().setCounts("ws-1", { "conv-1": 2 }, { "conv-1": items[1].sentAt });
    const { result } = renderDivider({ hasNextPage: true });
    expect(result.current.firstNewIndex).toBe(2);
    expect(result.current.moreAbove).toBe(false);
    expect(fetchNextPage).not.toHaveBeenCalled();
  });

  it("counts its pages for each conversation", () => {
    unreadFromBefore();
    const props = {
      items,
      firstPagePending: false,
      hasNextPage: true,
      isFetchingNextPage: false,
    };
    const { rerender } = renderDivider({ ...props, conversationId: "conv-1" });
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
    useUnreadStore
      .getState()
      .setCounts(
        "ws-1",
        { "conv-1": 200, "conv-2": 200 },
        { "conv-1": "2026-01-01T00:00:00Z", "conv-2": "2026-01-01T00:00:00Z" },
      );
    rerender({ ...props, conversationId: "conv-2" });
    expect(fetchNextPage).toHaveBeenCalledTimes(2);
  });
});

describe("useNewMessagesDivider: marking", () => {
  it("dismissing marks up to the newest message shown, never the clock's time", async () => {
    vi.setSystemTime(new Date(Date.UTC(2030, 0, 1)));
    useUnreadStore.getState().setCounts("ws-1", {}, {});
    useUnreadStore.setState({ watermarks: { "conv-1": items[0].sentAt } });
    const { result } = renderDivider();
    act(() => result.current.onScrollPosition(true));
    await wait(2000);
    expect(marks()).toEqual([items[3].sentAt]);
    expect(useUnreadStore.getState().watermarks).toEqual({});
  });

  it("dismissing with no message marks nothing", async () => {
    useUnreadStore.getState().setCounts("ws-1", {}, {});
    const { result } = renderDivider({ items: [] });
    act(() => result.current.markShownRead?.());
    act(() => result.current.onScrollPosition(true));
    await wait(2000);
    expect(marks()).toEqual([]);
  });

  it("marking by hand: the divider stays at the bottom and offers its button", async () => {
    useMessageDisplaySettingsStore.setState({ markReadByHand: true });
    useUnreadStore.getState().setCounts("ws-1", { "conv-1": 2 }, { "conv-1": items[1].sentAt });
    const { result } = renderDivider();
    act(() => result.current.onScrollPosition(true));
    await wait(5000);
    expect(marks()).toEqual([]);
    expect(result.current.firstNewIndex).toBe(2);
    expect(result.current.dividerFading).toBe(false);

    act(() => result.current.markShownRead?.());
    await wait(0);
    expect(marks()).toEqual([items[3].sentAt]);
    expect(useUnreadStore.getState().counts).toEqual({});
    expect(result.current.firstNewIndex).toBe(-1);
  });

  it("marking by hand: a mark from elsewhere ends the line", () => {
    useMessageDisplaySettingsStore.setState({ markReadByHand: true });
    useUnreadStore.getState().setCounts("ws-1", { "conv-1": 2 }, { "conv-1": items[1].sentAt });
    const { result } = renderDivider();
    expect(result.current.firstNewIndex).toBe(2);
    act(() => useUnreadStore.getState().markRead("conv-1"));
    expect(result.current.firstNewIndex).toBe(-1);
  });

  it("offers no button where reading marks by itself or the host has no marker", () => {
    useUnreadStore.getState().setCounts("ws-1", { "conv-1": 2 }, { "conv-1": items[1].sentAt });
    expect(renderDivider().result.current.markShownRead).toBeNull();

    useMessageDisplaySettingsStore.setState({ markReadByHand: true });
    useUnreadStore.getState().setCounts("ws-1", { "conv-1": 2 });
    expect(renderDivider().result.current.markShownRead).toBeNull();
  });
});
