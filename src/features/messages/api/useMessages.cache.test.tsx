import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClientError } from "graphql-request";
import type { ReactNode } from "react";

import { useAuthStore } from "../../auth/state/useAuthStore";
import type { MessagesPage } from "../../../core/types/messages";

const requestMock = vi.fn();
const readCachedTimelineMock = vi.fn();
const trackConversationMock = vi.fn();
const requestCacheSyncMock = vi.fn();
const account = { endpoint: "http://localhost:8080/api", userId: "u1" };
let conversation: { encryptedAt: string | null } | undefined;

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

vi.mock("./messageCache", async (importOriginal) => ({
  isServerUnreachable: (await importOriginal<typeof import("./messageCache")>())
    .isServerUnreachable,
  currentCacheAccount: () => (useAuthStore.getState().session ? account : null),
  encryptedStoreAccount: () => (useAuthStore.getState().session ? account : null),
  readCachedTimeline: (...args: unknown[]) => readCachedTimelineMock(...args),
  trackConversation: (...args: unknown[]) => trackConversationMock(...args),
}));

vi.mock("../../conversations/api/useConversation", () => ({
  useConversation: () => ({ data: conversation }),
}));

vi.mock("../runtime/messageCacheSync", () => ({
  requestCacheSync: (...args: unknown[]) => requestCacheSyncMock(...args),
}));

import { useConversationMessages } from "./useMessages";
import { MESSAGE_METADATA_QUERY } from "./serverMetadata";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function cachedPage(text: string): MessagesPage {
  return {
    items: [{ id: "m1", text } as MessagesPage["items"][number]],
    next: null,
    prev: null,
    pageInfo: { hasNext: false, hasPrev: false },
  };
}

describe("useConversationMessages with the local cache", () => {
  beforeEach(() => {
    requestMock.mockReset();
    readCachedTimelineMock.mockReset();
    trackConversationMock.mockReset().mockResolvedValue(undefined);
    requestCacheSyncMock.mockReset();
    useAuthStore.setState({ session: { userId: "u1" } });
    conversation = undefined;
  });

  it("follows the opened conversation and asks for its sync", async () => {
    requestMock.mockResolvedValue({ messages: cachedPage("from server") });
    readCachedTimelineMock.mockResolvedValue(null);

    renderHook(() => useConversationMessages("ws-1", "conv-1"), { wrapper });

    await waitFor(() => expect(requestCacheSyncMock).toHaveBeenCalledWith("ws-1", ["conv-1"]));
    expect(trackConversationMock).toHaveBeenCalledWith(account, "ws-1", "conv-1");
  });

  it("shows the cached page while the server has not answered", async () => {
    requestMock.mockReturnValue(new Promise(() => {}));
    readCachedTimelineMock.mockResolvedValue(cachedPage("from cache"));

    const { result } = renderHook(() => useConversationMessages("ws-1", "conv-1"), { wrapper });

    await waitFor(() => expect(result.current.data?.pages[0].items[0].text).toBe("from cache"));
    expect(result.current.isPlaceholderData).toBe(true);
  });

  it("serves the timeline from the cache when the server cannot be reached", async () => {
    requestMock.mockRejectedValue(new TypeError("Failed to fetch"));
    readCachedTimelineMock.mockResolvedValue(cachedPage("offline copy"));

    const { result } = renderHook(() => useConversationMessages("ws-1", "conv-1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.isPlaceholderData).toBe(false);
    expect(result.current.data?.pages[0].items[0].text).toBe("offline copy");
  });

  it("falls back to the cache on a 5xx from a proxy in front of the server", async () => {
    requestMock.mockRejectedValue(
      new ClientError({ status: 502, headers: new Headers() }, { query: "" }),
    );
    readCachedTimelineMock.mockResolvedValue(cachedPage("offline copy"));

    const { result } = renderHook(() => useConversationMessages("ws-1", "conv-1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pages[0].items[0].text).toBe("offline copy");
  });

  it("does not hide a server error behind the cache", async () => {
    requestMock.mockRejectedValue(
      new ClientError(
        { status: 200, errors: [{ message: "permission denied" }], headers: new Headers() },
        { query: "" },
      ),
    );
    readCachedTimelineMock.mockResolvedValue(null);

    const { result } = renderHook(() => useConversationMessages("ws-1", "conv-1"), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    // Only the placeholder read touched the cache; the failed query did not fall back.
    expect(readCachedTimelineMock).toHaveBeenCalledTimes(1);
  });
});

describe("useConversationMessages in an encrypted conversation", () => {
  const stored: MessagesPage = {
    items: [
      {
        id: "m1",
        text: "decrypted here",
        isPinned: false,
        rootThreadId: null,
        reactions: [],
      } as unknown as MessagesPage["items"][number],
      {
        id: "m2",
        text: "",
        isDeleted: true,
        isPinned: false,
        reactions: [],
      } as unknown as MessagesPage["items"][number],
    ],
    next: null,
    prev: null,
    pageInfo: { hasNext: false, hasPrev: false },
  };

  beforeEach(() => {
    requestMock.mockReset();
    readCachedTimelineMock.mockReset().mockResolvedValue(stored);
    trackConversationMock.mockReset().mockResolvedValue(undefined);
    requestCacheSyncMock.mockReset();
    useAuthStore.setState({ session: { userId: "u1" } });
    conversation = { encryptedAt: "2026-10-25T18:00:00Z" };
  });

  it("takes the text from the store and reactions, pins and threads from the server", async () => {
    const reaction = { emoji: "😀", count: 1, reactedByMe: true, userIds: ["u1"] };
    requestMock.mockResolvedValue({
      messages: {
        items: [{ id: "m1", isPinned: true, rootThreadId: "t1", reactions: [reaction] }],
      },
    });

    const { result } = renderHook(() => useConversationMessages("ws-1", "conv-1"), { wrapper });

    await waitFor(() => expect(result.current.data?.pages[0].items[0].reactions).toHaveLength(1));
    const [m1, m2] = result.current.data!.pages[0].items;
    expect(m1).toMatchObject({
      text: "decrypted here",
      isPinned: true,
      rootThreadId: "t1",
      reactions: [reaction],
    });
    // A message the server did not answer for keeps what the store has.
    expect(m2).toMatchObject({ isDeleted: true, reactions: [] });
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(requestMock).toHaveBeenCalledWith(MESSAGE_METADATA_QUERY, {
      serverId: "ws-1",
      conversationId: "conv-1",
      dir: "AFTER",
      limit: 50,
      includeDeleted: false,
    });
  });

  it("asks the server for the window of the stored page it read", async () => {
    requestMock.mockResolvedValue({ messages: { items: [] } });
    const cursor = { sentAt: "2026-10-25T18:30:00Z", messageId: "m9" };
    readCachedTimelineMock.mockResolvedValue({
      ...stored,
      next: cursor,
      pageInfo: { hasNext: true, hasPrev: false },
    });

    const { result } = renderHook(() => useConversationMessages("ws-1", "conv-1"), { wrapper });

    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await result.current.fetchNextPage();
    expect(readCachedTimelineMock).toHaveBeenLastCalledWith(account, "ws-1", "conv-1", cursor, 50);
    expect(requestMock).toHaveBeenLastCalledWith(
      MESSAGE_METADATA_QUERY,
      expect.objectContaining({ cursor, limit: 50, dir: "AFTER" }),
    );
  });

  it("keeps the stored page when the server cannot answer", async () => {
    requestMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const { result } = renderHook(() => useConversationMessages("ws-1", "conv-1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.isPlaceholderData).toBe(false);
    expect(result.current.data?.pages[0].items[0]).toMatchObject({
      text: "decrypted here",
      reactions: [],
    });
  });
});
