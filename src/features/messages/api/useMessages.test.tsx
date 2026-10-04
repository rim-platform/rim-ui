import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

import { useConversationMessages } from "./useMessages";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const oldestCursor = { sentAt: "2026-10-04T10:00:00Z", id: "m5" };

function page(hasNext: boolean) {
  return {
    messages: {
      items: [],
      next: hasNext ? oldestCursor : null,
      prev: null,
      pageInfo: { hasNext, hasPrev: false },
    },
  };
}

describe("useConversationMessages", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("opens with no cursor and loads older history with AFTER + next (A-H1)", async () => {
    // `messages` is a DESC endpoint: AFTER is "older". BEFORE walked toward newer messages
    // and returned an empty page after the first one, dead-ending scroll-up.
    requestMock.mockResolvedValueOnce(page(true)).mockResolvedValueOnce(page(false));

    const { result } = renderHook(() => useConversationMessages("ws-1", "conv-1"), {
      wrapper,
    });

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    expect(requestMock.mock.calls[0][1]).toEqual({
      serverId: "ws-1",
      conversationId: "conv-1",
      dir: "AFTER",
      limit: 50,
      includeDeleted: false,
    });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));

    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    expect(requestMock.mock.calls[1][1]).toMatchObject({
      dir: "AFTER",
      cursor: oldestCursor,
    });
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
  });
});
