import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { PageDir } from "../../../core/graphql/generated/schema-types";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

import { useSearchMessages, flattenSearchPages } from "./useSearchMessages";
import type { SearchResultPage } from "./useSearchMessages";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/** Waits out the hook's 300ms search debounce with real timers. */
async function waitForDebounce() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 320));
  });
}

function page(overrides: Partial<SearchResultPage> = {}): SearchResultPage {
  return {
    items: [],
    next: null,
    prev: null,
    pageInfo: { hasNext: false, hasPrev: false },
    ...overrides,
  };
}

const item1 = {
  id: "m1",
  serverId: "ws-1",
  conversationId: "conv-1",
  conversationTitle: "general",
  conversationType: "CHANNEL",
  threadId: null,
  authorId: "u1",
  author: { id: "u1", username: "alice", displayName: "Alice", avatarUrl: null },
  text: "the deploy failed",
  sentAt: "2026-07-01T00:00:00Z",
  rootMessageId: null,
  rank: 0.8,
  headline: "the <mark>deploy</mark> failed",
};

const item2 = {
  ...item1,
  id: "m2",
  text: "deploy succeeded",
  headline: "<mark>deploy</mark> succeeded",
  rank: 0.5,
};

describe("useSearchMessages", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("is disabled until the debounced query is non-empty", () => {
    requestMock.mockResolvedValue({ searchMessages: page() });
    renderHook(() => useSearchMessages("ws-1", undefined, ""), { wrapper });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("sends a SearchMessagesInput (not the old positional args) after the debounce", async () => {
    requestMock.mockResolvedValue({ searchMessages: page({ items: [item1] }) });
    renderHook(() => useSearchMessages("ws-1", "conv-1", "deploy"), { wrapper });

    await waitForDebounce();
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));

    const [, variables] = requestMock.mock.calls[0];
    expect(variables).toEqual({
      input: {
        serverId: "ws-1",
        query: "deploy",
        conversationId: "conv-1",
        limit: 25,
        dir: PageDir.AFTER,
        cursor: undefined,
      },
    });
  });

  it("maps SearchResultPage.items including rank and headline", async () => {
    requestMock.mockResolvedValue({ searchMessages: page({ items: [item1, item2] }) });
    const { result } = renderHook(() => useSearchMessages("ws-1", undefined, "deploy"), {
      wrapper,
    });

    await waitForDebounce();
    await waitFor(() => expect(result.current.data).toBeDefined());

    const items = result.current.data!.pages[0].items;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: "m1",
      rank: 0.8,
      headline: "the <mark>deploy</mark> failed",
    });
    expect(items[1]).toMatchObject({
      id: "m2",
      rank: 0.5,
      headline: "<mark>deploy</mark> succeeded",
    });
  });

  it("getNextPageParam returns the next cursor when hasNext is true", async () => {
    const cursor = { sentAt: "2026-07-01T00:00:00Z", messageId: "m1" };
    requestMock.mockResolvedValue({
      searchMessages: page({
        items: [item1],
        next: cursor,
        pageInfo: { hasNext: true, hasPrev: false },
      }),
    });
    const { result } = renderHook(() => useSearchMessages("ws-1", undefined, "deploy"), {
      wrapper,
    });

    await waitForDebounce();
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.hasNextPage).toBe(true);
  });

  it("getNextPageParam returns undefined when hasNext is false", async () => {
    requestMock.mockResolvedValue({
      searchMessages: page({ items: [item1], pageInfo: { hasNext: false, hasPrev: false } }),
    });
    const { result } = renderHook(() => useSearchMessages("ws-1", undefined, "deploy"), {
      wrapper,
    });

    await waitForDebounce();
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.hasNextPage).toBe(false);
  });

  it("fetchNextPage sends the previous page's cursor", async () => {
    const cursor = { sentAt: "2026-07-01T00:00:00Z", messageId: "m1" };
    requestMock
      .mockResolvedValueOnce({
        searchMessages: page({
          items: [item1],
          next: cursor,
          pageInfo: { hasNext: true, hasPrev: false },
        }),
      })
      .mockResolvedValueOnce({
        searchMessages: page({ items: [item2], pageInfo: { hasNext: false, hasPrev: true } }),
      });

    const { result } = renderHook(() => useSearchMessages("ws-1", undefined, "deploy"), {
      wrapper,
    });

    await waitForDebounce();
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));

    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    const [, secondVariables] = requestMock.mock.calls[1];
    expect((secondVariables as { input: { cursor: unknown } }).input.cursor).toEqual(cursor);
  });
});

describe("flattenSearchPages", () => {
  it("returns an empty array for undefined data", () => {
    expect(flattenSearchPages(undefined)).toEqual([]);
  });

  it("concatenates items across pages in order", () => {
    const data = {
      pages: [page({ items: [item1] }), page({ items: [item2] })],
      pageParams: [undefined, { sentAt: item1.sentAt, messageId: item1.id }],
    };
    expect(flattenSearchPages(data)).toEqual([item1, item2]);
  });
});
