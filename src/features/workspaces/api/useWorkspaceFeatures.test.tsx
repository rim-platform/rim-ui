import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { WorkspaceFeature } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

import { useSetWorkspaceFeature, useWorkspaceFeatures } from "./useWorkspaceFeatures";

function makeWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe("useWorkspaceFeatures", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("fetches the features for the given server", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    requestMock.mockResolvedValue({
      workspaceFeatures: [{ feature: WorkspaceFeature.INCIDENTS, enabled: true, updatedAt: null }],
    });
    const { result } = renderHook(() => useWorkspaceFeatures("srv-1"), {
      wrapper: makeWrapper(qc),
    });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(requestMock).toHaveBeenCalledWith(expect.stringContaining("workspaceFeatures"), {
      serverId: "srv-1",
    });
  });
});

describe("useSetWorkspaceFeature", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("sends the variables, applies the result and refreshes features, myServers and commands", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(queryKeys.workspaceFeatures("srv-1"), [
      { feature: WorkspaceFeature.INCIDENTS, enabled: true, updatedAt: null },
    ]);
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    requestMock.mockResolvedValue({
      setWorkspaceFeature: {
        feature: WorkspaceFeature.INCIDENTS,
        enabled: false,
        updatedAt: "2026-10-04T00:00:00Z",
      },
    });

    const { result } = renderHook(() => useSetWorkspaceFeature(), { wrapper: makeWrapper(qc) });
    await act(async () => {
      await result.current.mutateAsync({
        serverId: "srv-1",
        feature: WorkspaceFeature.INCIDENTS,
        enabled: false,
      });
    });

    expect(requestMock).toHaveBeenCalledWith(expect.stringContaining("setWorkspaceFeature"), {
      serverId: "srv-1",
      feature: WorkspaceFeature.INCIDENTS,
      enabled: false,
    });
    expect(qc.getQueryData(queryKeys.workspaceFeatures("srv-1"))).toEqual([
      { feature: WorkspaceFeature.INCIDENTS, enabled: false, updatedAt: "2026-10-04T00:00:00Z" },
    ]);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.workspaceFeatures("srv-1"),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.myServers() });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["commands"] });
  });
});
