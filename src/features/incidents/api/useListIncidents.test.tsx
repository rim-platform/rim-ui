import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import {
  IncidentSeverityGql,
  IncidentStatusGql,
} from "../../../core/graphql/generated/schema-types";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

import { useListIncidents } from "./useListIncidents";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const emptyPage = {
  listIncidents: {
    items: [],
    next: null,
    prev: null,
    pageInfo: { hasNext: false, hasPrev: false },
  },
};

describe("useListIncidents", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("is disabled when serverId is null", () => {
    requestMock.mockResolvedValue(emptyPage);
    renderHook(() => useListIncidents({ serverId: null }), { wrapper });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("calls graphqlClient.request with default dir=AFTER and null filters", async () => {
    requestMock.mockResolvedValue(emptyPage);
    renderHook(() => useListIncidents({ serverId: "ws-1" }), { wrapper });

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    expect(requestMock.mock.calls[0][1]).toEqual({
      serverId: "ws-1",
      statusFilter: null,
      severityFilter: null,
      dir: "AFTER",
      cursor: null,
      limit: 20,
    });
  });

  it("normalizes empty filter arrays to null", async () => {
    requestMock.mockResolvedValue(emptyPage);
    renderHook(
      () =>
        useListIncidents({
          serverId: "ws-1",
          statusFilter: [],
          severityFilter: [],
        }),
      { wrapper },
    );

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    expect(requestMock.mock.calls[0][1]).toMatchObject({
      statusFilter: null,
      severityFilter: null,
    });
  });

  it("forwards non-empty filter arrays as-is", async () => {
    requestMock.mockResolvedValue(emptyPage);
    renderHook(
      () =>
        useListIncidents({
          serverId: "ws-1",
          statusFilter: [IncidentStatusGql.ACTIVE, IncidentStatusGql.MITIGATED],
          severityFilter: [IncidentSeverityGql.SEV_1],
        }),
      { wrapper },
    );

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    expect(requestMock.mock.calls[0][1]).toMatchObject({
      statusFilter: [IncidentStatusGql.ACTIVE, IncidentStatusGql.MITIGATED],
      severityFilter: [IncidentSeverityGql.SEV_1],
    });
  });

  it("forwards cursor + dir for pagination", async () => {
    requestMock.mockResolvedValue(emptyPage);
    const cursor = { createdAt: "2026-04-22T10:00:00Z", incidentId: "inc-9" };
    renderHook(
      () =>
        useListIncidents({
          serverId: "ws-1",
          cursor,
          dir: "BEFORE",
        }),
      { wrapper },
    );

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    expect(requestMock.mock.calls[0][1]).toMatchObject({
      cursor,
      dir: "BEFORE",
    });
  });
});
