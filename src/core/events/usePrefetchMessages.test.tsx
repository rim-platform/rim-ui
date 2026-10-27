import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { queryKeys } from "../query/keys";
import { queryClient } from "../query/queryClient";
import { fakeServerInfo } from "../../test/serverInfo";

const requestMock = vi.fn();

vi.mock("../graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

import { usePrefetchMessages } from "./usePrefetchMessages";
import { useConversationMessages } from "../../features/messages/api/useMessages";

const emptyPage = {
  messages: { items: [], next: null, prev: null, pageInfo: { hasNext: false, hasPrev: false } },
};

/** The conversation id of every messages request, in call order. */
function requestedConversations(): string[] {
  return requestMock.mock.calls.map(
    (call) => (call[1] as { conversationId: string }).conversationId,
  );
}

function renderWithClient(children: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(<QueryClientProvider client={qc}>{children}</QueryClientProvider>);
}

function Prefetch({ ids }: { ids: string[] }) {
  usePrefetchMessages("ws-1", ids);
  return null;
}

function TimelineAndPrefetch({ ids }: { ids: string[] }) {
  useConversationMessages("ws-1", "c-1");
  usePrefetchMessages("ws-1", ids);
  return null;
}

describe("usePrefetchMessages", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockResolvedValue(emptyPage);
    queryClient.clear();
    queryClient.setQueryData(queryKeys.serverInfo, fakeServerInfo());
  });

  it("prefetches a listed conversation the cache has no query for", async () => {
    renderWithClient(<Prefetch ids={["c-2"]} />);

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    expect(requestedConversations()).toEqual(["c-2"]);
  });

  it("leaves a conversation whose timeline query exists to that query", async () => {
    renderWithClient(<TimelineAndPrefetch ids={["c-1", "c-2"]} />);

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    // Let any second request for either conversation arrive before counting.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const requested = requestedConversations();
    expect(requested.filter((id) => id === "c-1")).toHaveLength(1);
    expect(requested.filter((id) => id === "c-2")).toHaveLength(1);
  });
});
