import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { IncidentSeverityGql } from "../../../core/graphql/generated/schema-types";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

import { useIngestTokens, useCreateIngestToken, useRevokeIngestToken } from "./useIngestTokens";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const sampleToken = {
  id: "tok-1",
  serverId: "ws-1",
  conversationId: "conv-1",
  createdBy: "u1",
  label: "Prod Alertmanager",
  severityDefault: IncidentSeverityGql.SEV_2,
  createdAt: "2026-07-01T00:00:00Z",
  revokedAt: null,
  lastUsedAt: null,
};

describe("useIngestTokens", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("is disabled when serverId is undefined", () => {
    requestMock.mockResolvedValue({ ingestTokens: [] });
    renderHook(() => useIngestTokens(undefined), { wrapper });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("queries ingestTokens for the given serverId and returns the list", async () => {
    requestMock.mockResolvedValue({ ingestTokens: [sampleToken] });
    const { result } = renderHook(() => useIngestTokens("ws-1"), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual([sampleToken]);
    expect(requestMock.mock.calls[0][1]).toEqual({ serverId: "ws-1" });
  });
});

describe("useCreateIngestToken", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("sends the CreateIngestTokenInput and surfaces the raw token once", async () => {
    requestMock.mockResolvedValue({
      createIngestToken: { rawToken: "rim_ingest_abc123", token: sampleToken },
    });
    const { result } = renderHook(() => useCreateIngestToken(), { wrapper });

    let returned: unknown;
    await act(async () => {
      returned = await result.current.mutateAsync({
        serverId: "ws-1",
        conversationId: "conv-1",
        label: "Prod Alertmanager",
        severityDefault: IncidentSeverityGql.SEV_2,
      });
    });

    expect(requestMock.mock.calls[0][1]).toEqual({
      input: {
        serverId: "ws-1",
        conversationId: "conv-1",
        label: "Prod Alertmanager",
        severityDefault: IncidentSeverityGql.SEV_2,
      },
    });
    expect(returned).toEqual({
      rawToken: "rim_ingest_abc123",
      token: sampleToken,
    });
  });

  it("invalidates the ingestTokens list for the token's workspace on success", async () => {
    requestMock.mockResolvedValue({
      createIngestToken: { rawToken: "rim_ingest_abc123", token: sampleToken },
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useCreateIngestToken(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      ),
    });

    await act(async () => {
      await result.current.mutateAsync({
        serverId: "ws-1",
        conversationId: "conv-1",
        label: "Prod Alertmanager",
      });
    });

    expect(spy).toHaveBeenCalledWith({ queryKey: ["ingestTokens", "ws-1"] });
  });
});

describe("useRevokeIngestToken", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("sends the tokenId and invalidates the ingestTokens list on success", async () => {
    requestMock.mockResolvedValue({ revokeIngestToken: true });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useRevokeIngestToken(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      ),
    });

    await act(async () => {
      await result.current.mutateAsync({ serverId: "ws-1", tokenId: "tok-1" });
    });

    expect(requestMock.mock.calls[0][1]).toEqual({ tokenId: "tok-1" });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["ingestTokens", "ws-1"] });
  });
});
