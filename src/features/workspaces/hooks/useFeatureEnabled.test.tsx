import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { WorkspaceFeature } from "../../../core/graphql/generated/schema-types";
import { useWorkspaceStore } from "../state/useWorkspaceStore";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

import { useFeatureEnabled, useFeatureStatus, useIsCommandAvailable } from "./useFeatureEnabled";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function featuresResponse(enabled: boolean) {
  return {
    workspaceFeatures: [{ feature: WorkspaceFeature.INCIDENTS, enabled, updatedAt: null }],
  };
}

describe("useFeatureEnabled", () => {
  beforeEach(() => {
    requestMock.mockReset();
    useWorkspaceStore.setState({ workspaceId: "srv-1" });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
  });

  it("is false while the features query is loading", () => {
    requestMock.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useFeatureEnabled(WorkspaceFeature.INCIDENTS), {
      wrapper,
    });
    expect(result.current).toBe(false);
    expect(requestMock).toHaveBeenCalledWith(expect.stringContaining("workspaceFeatures"), {
      serverId: "srv-1",
    });
  });

  it("is false with no active workspace and issues no request", () => {
    useWorkspaceStore.setState({ workspaceId: null });
    const { result } = renderHook(() => useFeatureEnabled(WorkspaceFeature.INCIDENTS), {
      wrapper,
    });
    expect(result.current).toBe(false);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("is true once the server reports the feature on", async () => {
    requestMock.mockResolvedValue(featuresResponse(true));
    const { result } = renderHook(() => useFeatureEnabled(WorkspaceFeature.INCIDENTS), {
      wrapper,
    });
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("stays false when the server reports the feature off", async () => {
    requestMock.mockResolvedValue(featuresResponse(false));
    const { result } = renderHook(() => useFeatureStatus(WorkspaceFeature.INCIDENTS), {
      wrapper,
    });
    await waitFor(() => expect(result.current).toBe("disabled"));
  });

  it("reports loading, then the resolved state, through useFeatureStatus", async () => {
    let resolve: (value: unknown) => void = () => {};
    requestMock.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const { result } = renderHook(() => useFeatureStatus(WorkspaceFeature.INCIDENTS), {
      wrapper,
    });
    expect(result.current).toBe("loading");
    resolve(featuresResponse(true));
    await waitFor(() => expect(result.current).toBe("enabled"));
  });

  it("keeps a failed features query unknown rather than reading it as turned off", async () => {
    requestMock.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(
      () => ({
        status: useFeatureStatus(WorkspaceFeature.INCIDENTS),
        enabled: useFeatureEnabled(WorkspaceFeature.INCIDENTS),
      }),
      { wrapper },
    );
    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.status).toBe("loading");
    expect(result.current.enabled).toBe(false);
  });
});

describe("useIsCommandAvailable", () => {
  beforeEach(() => {
    requestMock.mockReset();
    useWorkspaceStore.setState({ workspaceId: "srv-1" });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
  });

  it("hides incident and on-call commands until the feature is known to be on", async () => {
    requestMock.mockResolvedValue(featuresResponse(false));
    const { result } = renderHook(() => useIsCommandAvailable(), { wrapper });
    expect(result.current("incident.ack")).toBe(false);
    expect(result.current("chat.open_thread")).toBe(true);
    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    expect(result.current("oncall.who")).toBe(false);
  });

  it("offers incident and on-call commands when the feature is on", async () => {
    requestMock.mockResolvedValue(featuresResponse(true));
    const { result } = renderHook(() => useIsCommandAvailable(), { wrapper });
    await waitFor(() => expect(result.current("incident.ack")).toBe(true));
    expect(result.current("oncall.take_shift")).toBe(true);
  });
});
