import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));

import { queryKeys } from "../../../core/query/keys";
import { queryClient } from "../../../core/query/queryClient";
import { fakeServerInfo } from "../../../test/serverInfo";
import { routeRequests } from "../../conversations/__fixtures__/conversations";
import { useThreadMessages } from "./useThreads";

describe("thread query keys", () => {
  it("threadByRoot produces consistent key shape", () => {
    const key = queryKeys.threadByRoot("ws-1", "conv-1", "msg-1");
    expect(key).toEqual(["threadByRoot", "ws-1", "conv-1", "msg-1"]);
  });

  it("threadByRoot handles undefined args", () => {
    const key = queryKeys.threadByRoot(undefined, undefined, undefined);
    expect(key).toEqual(["threadByRoot", undefined, undefined, undefined]);
  });

  it("threadMessages produces consistent key shape", () => {
    const key = queryKeys.threadMessages("ws-1", "conv-1", "thread-1");
    expect(key).toEqual(["threadMessages", "ws-1", "conv-1", "thread-1"]);
  });

  it("threadMessages handles undefined args", () => {
    const key = queryKeys.threadMessages(undefined, undefined, undefined);
    expect(key).toEqual(["threadMessages", undefined, undefined, undefined]);
  });

  it("thread keys are distinct from message keys", () => {
    const threadKey = queryKeys.threadByRoot("ws-1", "conv-1", "msg-1");
    const msgKey = queryKeys.messages("ws-1", "conv-1");
    expect(threadKey[0]).not.toBe(msgKey[0]);
  });
});

describe("useThreadMessages", () => {
  beforeEach(() => {
    requestMock.mockReset();
    queryClient.clear();
  });

  function wrapper({ children }: { children: ReactNode }) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    return createElement(QueryClientProvider, { client: qc }, children);
  }

  it("asks for editedAt only when the server lists message_edited_at", async () => {
    for (const capabilities of [["message_edited_at"], []]) {
      queryClient.clear();
      requestMock.mockReset();
      const replies = { items: [], pageInfo: { hasNext: false, hasPrev: false } };
      routeRequests(requestMock, {
        "query ServerInfo {": () => ({ serverInfo: { ...fakeServerInfo(), capabilities } }),
        "query ThreadMessagesWithEdits(": () => ({ threadMessages: replies }),
        "query ThreadMessages(": () => ({ threadMessages: replies }),
      });

      const { result, unmount } = renderHook(() => useThreadMessages("ws-1", "c-1", "t-1"), {
        wrapper,
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      const operations = requestMock.mock.calls.map(
        ([document]) => /query (\w+)/.exec(String(document))?.[1],
      );
      expect(operations).toEqual([
        "ServerInfo",
        capabilities.length > 0 ? "ThreadMessagesWithEdits" : "ThreadMessages",
      ]);
      unmount();
    }
  });
});
