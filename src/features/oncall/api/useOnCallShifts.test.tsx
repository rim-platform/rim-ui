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

import { useOnCallShifts } from "./useOnCallShifts";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const shifts = [
  {
    startAt: "2026-07-08T00:00:00Z",
    endAt: "2026-07-09T00:00:00Z",
    user: { id: "u1", username: "alice", displayName: "Alice", avatarUrl: null },
  },
];

describe("useOnCallShifts", () => {
  beforeEach(() => requestMock.mockReset());

  it("is disabled unless scheduleId/from/to are all present", () => {
    renderHook(() => useOnCallShifts(undefined, "2026-07-08T00:00:00Z", "2026-07-09T00:00:00Z"), {
      wrapper,
    });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("fetches server-resolved shifts for the given window", async () => {
    requestMock.mockResolvedValue({ onCallShifts: shifts });
    const { result } = renderHook(
      () => useOnCallShifts("sched-1", "2026-07-08T00:00:00Z", "2026-07-09T00:00:00Z"),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data).toEqual(shifts));
    expect(requestMock.mock.calls[0][1]).toEqual({
      scheduleId: "sched-1",
      from: "2026-07-08T00:00:00Z",
      to: "2026-07-09T00:00:00Z",
    });
  });
});
