import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { ClientError } from "graphql-request";

import { PageDir } from "../../../core/graphql/generated/schema-types";
import { useAuthStore } from "../../auth/state/useAuthStore";

const requestMock = vi.fn();
const searchCachedMessagesMock = vi.fn();
/** The cache account; null (no cache, as in the web app) unless a test sets it. */
let cacheAccount: { endpoint: string; userId: string } | null = null;

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

vi.mock("./messageCache", async (importOriginal) => ({
  isServerUnreachable: (await importOriginal<typeof import("./messageCache")>())
    .isServerUnreachable,
  currentCacheAccount: () => cacheAccount,
  searchCachedMessages: (...args: unknown[]) => searchCachedMessagesMock(...args),
}));

import { buildConversationDirectory } from "./localSearch";
import { useSearchMessages, useLocalSearchHits, flattenSearchPages } from "./useSearchMessages";
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
    searchCachedMessagesMock.mockReset();
    cacheAccount = null;
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

const localHit = {
  id: "local-1",
  serverId: "ws-1",
  conversationId: "conv-1",
  threadId: null,
  rootMessageId: null,
  authorId: "u1",
  author: { id: "u1", username: "alice", displayName: "Alice", avatarUrl: null },
  text: "deploy notes",
  sentAt: "2026-07-02T00:00:00Z",
  rank: 2,
  headline: "<mark>deploy</mark> notes",
};

const directory = buildConversationDirectory([
  [{ id: "conv-1", title: "general", conversationType: "CHANNEL" }] as never,
]);

describe("useSearchMessages offline", () => {
  beforeEach(() => {
    requestMock.mockReset();
    searchCachedMessagesMock.mockReset();
    cacheAccount = { endpoint: "http://localhost:8080/api", userId: "u1" };
  });

  it("serves the page from the local index when the server cannot be reached", async () => {
    requestMock.mockRejectedValue(new TypeError("Failed to fetch"));
    searchCachedMessagesMock.mockResolvedValue({ items: [localHit], hasMore: true });
    const { result } = renderHook(
      () => useSearchMessages("ws-1", undefined, "deploy in:#general", directory),
      { wrapper },
    );

    await waitForDebounce();
    await waitFor(() => expect(result.current.data).toBeDefined());

    const first = result.current.data!.pages[0];
    expect(first.source).toBe("local");
    expect(first.items[0]).toMatchObject({ id: "local-1", conversationTitle: "general" });
    expect(searchCachedMessagesMock).toHaveBeenCalledWith(
      cacheAccount,
      "ws-1",
      { text: "deploy", conversationId: "conv-1" },
      null,
      25,
    );
    expect(result.current.hasNextPage).toBe(true);
  });

  it("does not stand in for an answer the server gave", async () => {
    requestMock.mockRejectedValue(
      new ClientError({ status: 200, errors: [{ message: "bad query" }] } as never, {
        query: "",
      }),
    );
    const { result } = renderHook(() => useSearchMessages("ws-1", undefined, "deploy"), {
      wrapper,
    });

    await waitForDebounce();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(searchCachedMessagesMock).not.toHaveBeenCalled();
  });
});

describe("useLocalSearchHits", () => {
  beforeEach(() => {
    searchCachedMessagesMock.mockReset();
    cacheAccount = { endpoint: "http://localhost:8080/api", userId: "u1" };
    useAuthStore.setState({ session: { userId: "u1" } } as never);
  });

  it("returns the newest local hits as search items", async () => {
    searchCachedMessagesMock.mockResolvedValue({ items: [localHit], hasMore: false });
    const { result } = renderHook(
      () => useLocalSearchHits("ws-1", undefined, "deploy", directory),
      { wrapper },
    );

    await waitForDebounce();
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data![0]).toMatchObject({ id: "local-1", conversationTitle: "general" });
    expect(searchCachedMessagesMock).toHaveBeenCalledWith(
      cacheAccount,
      "ws-1",
      { text: "deploy" },
      null,
      100,
    );
  });

  it("names conversations from the lists as they are now", async () => {
    searchCachedMessagesMock.mockResolvedValue({ items: [localHit], hasMore: false });
    const { result, rerender } = renderHook(
      ({ dir }) => useLocalSearchHits("ws-1", undefined, "deploy", dir),
      { wrapper, initialProps: { dir: buildConversationDirectory([]) } },
    );

    await waitForDebounce();
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data![0].conversationTitle).toBeNull();

    rerender({ dir: directory });
    await waitFor(() => expect(result.current.data![0].conversationTitle).toBe("general"));
    expect(searchCachedMessagesMock).toHaveBeenCalledTimes(1);
  });

  it("stays idle without a cache", async () => {
    cacheAccount = null;
    renderHook(() => useLocalSearchHits("ws-1", undefined, "deploy", directory), { wrapper });
    await waitForDebounce();
    expect(searchCachedMessagesMock).not.toHaveBeenCalled();
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
