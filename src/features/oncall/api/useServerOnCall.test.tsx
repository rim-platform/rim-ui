import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

import { useServerOnCall } from "./useServerOnCall";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const entry = {
  scheduleId: "sched-1",
  shiftEndsAt: "2026-07-09T00:00:00Z",
  currentUser: { id: "u1", username: "alice", displayName: "Alice", avatarUrl: null },
  nextUser: null,
};

describe("useServerOnCall", () => {
  beforeEach(() => requestMock.mockReset());

  it("is disabled without a serverId", () => {
    renderHook(() => useServerOnCall(undefined), { wrapper });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("fetches the batch on-call resolver for the server", async () => {
    requestMock.mockResolvedValue({ serverOnCall: [entry] });
    const { result } = renderHook(() => useServerOnCall("srv-1"), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([entry]));
    expect(requestMock.mock.calls[0][1]).toEqual({ serverId: "srv-1" });
  });
});
