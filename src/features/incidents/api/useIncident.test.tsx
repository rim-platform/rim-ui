import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

import { useAcknowledgeIncident } from "./useIncident";

describe("useAcknowledgeIncident", () => {
  beforeEach(() => requestMock.mockReset());

  it("sends the incidentId and invalidates activeIncident + incidentTimeline for the caller-supplied ids", async () => {
    requestMock.mockResolvedValue({
      acknowledgeIncident: {
        id: "inc-1",
        acknowledgedAt: "2026-07-08T00:00:00Z",
        acknowledgedBy: "u1",
        acknowledgedByUser: { id: "u1", username: "alice", displayName: "Alice", avatarUrl: null },
      },
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useAcknowledgeIncident(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      ),
    });

    await act(async () => {
      await result.current.mutateAsync({
        incidentId: "inc-1",
        serverId: "srv-1",
        conversationId: "conv-1",
      });
    });

    expect(requestMock.mock.calls[0][1]).toEqual({ incidentId: "inc-1" });
    expect(spy).toHaveBeenCalledWith({
      queryKey: ["activeIncident", "srv-1", "conv-1"],
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["incidentTimeline", "inc-1"] });
  });
});
