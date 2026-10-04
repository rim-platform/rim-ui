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

import { useWhoIsOnCall } from "./useWhoIsOnCall";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const entry = {
  scheduleId: "sched-1",
  shiftEndsAt: "2026-07-09T00:00:00Z",
  currentUser: { id: "u1", username: "alice", displayName: "Alice", avatarUrl: null },
  nextUser: { id: "u2", username: "bob", displayName: "Bob", avatarUrl: null },
};

describe("useWhoIsOnCall", () => {
  beforeEach(() => requestMock.mockReset());

  it("is disabled without a scheduleId", () => {
    renderHook(() => useWhoIsOnCall(undefined), { wrapper });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("fetches the point resolver for a schedule", async () => {
    requestMock.mockResolvedValue({ whoIsOnCall: entry });
    const { result } = renderHook(() => useWhoIsOnCall("sched-1"), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(entry));
    expect(requestMock.mock.calls[0][1]).toEqual({ scheduleId: "sched-1", at: undefined });
  });

  it("passes an explicit `at` timestamp through", async () => {
    requestMock.mockResolvedValue({ whoIsOnCall: entry });
    renderHook(() => useWhoIsOnCall("sched-1", "2026-07-01T00:00:00Z"), { wrapper });
    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    expect(requestMock.mock.calls[0][1]).toEqual({
      scheduleId: "sched-1",
      at: "2026-07-01T00:00:00Z",
    });
  });
});
