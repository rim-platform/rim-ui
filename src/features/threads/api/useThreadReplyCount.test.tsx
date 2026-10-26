import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { createTestQueryClient } from "../../../test/utils";
import { graphqlError } from "../../conversations/__fixtures__/conversations";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));

import { useThreadReplyCount } from "./useThreadReplyCount";

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

describe("useThreadReplyCount", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("returns a thread root's reply count", async () => {
    requestMock.mockResolvedValue({ message: { id: "msg-1", threadReplyCount: 3 } });
    const { result } = renderHook(() => useThreadReplyCount("ws-1", "conv-1", "msg-1", true), {
      wrapper,
    });
    await waitFor(() => expect(result.current).toBe(3));
    expect(requestMock).toHaveBeenCalledWith(expect.stringContaining("query ThreadReplyCount("), {
      serverId: "ws-1",
      conversationId: "conv-1",
      messageId: "msg-1",
    });
  });

  it("returns null when the server reports no count", async () => {
    requestMock.mockResolvedValue({ message: { id: "msg-1", threadReplyCount: null } });
    const { result } = renderHook(() => useThreadReplyCount("ws-1", "conv-1", "msg-1", true), {
      wrapper,
    });
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current).toBeNull();
  });

  it("returns null, asking once, when the server refuses the field", async () => {
    requestMock.mockRejectedValue(
      graphqlError("GRAPHQL_VALIDATION_FAILED", 'Unknown field "threadReplyCount"'),
    );
    // A client that retries by default: only the hook's own setting keeps it to one request.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: 3, retryDelay: 0 } } });
    const { result } = renderHook(() => useThreadReplyCount("ws-1", "conv-1", "msg-1", true), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      ),
    });
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result.current).toBeNull();
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("asks nothing for a message that is not a thread root", async () => {
    const { result } = renderHook(() => useThreadReplyCount("ws-1", "conv-1", "msg-1", false), {
      wrapper,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(requestMock).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });
});
