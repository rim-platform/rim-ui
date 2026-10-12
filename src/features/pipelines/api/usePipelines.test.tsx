import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { PipelineTriggerKindGql } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { DIRECT_SPACE_ID, startRelayWithDirectSpace } from "../../../test/directSpace";
import { useRelayStore } from "../../relay/state/useRelayStore";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

import {
  usePipelines,
  useCreatePipelineMutation,
  useUpdatePipelineMutation,
  useDeletePipelineMutation,
  useTogglePipelineMutation,
} from "./usePipelines";
import type { Pipeline } from "./usePipelines";

let qc: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const pipeline: Pipeline = {
  id: "p-1",
  serverId: "ws-1",
  name: "Escalate urgent",
  description: null,
  trigger: { kind: PipelineTriggerKindGql.NEW_MESSAGE, conversationId: null },
  filter: null,
  actions: [{ actionType: "COMMAND", commandId: "chat.pin", args: null }],
  enabled: true,
  cooldownSecs: null,
  createdBy: "u-1",
  schemaVersion: 1,
  lastFiredAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("pipeline api hooks", () => {
  beforeEach(() => {
    requestMock.mockReset();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  });

  afterEach(() => useRelayStore.getState().reset());

  it("does not query without a workspace", () => {
    renderHook(() => usePipelines(undefined), { wrapper });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("does not query in a direct space", () => {
    startRelayWithDirectSpace();
    renderHook(() => usePipelines(DIRECT_SPACE_ID), { wrapper });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("lists pipelines for the workspace", async () => {
    requestMock.mockResolvedValue({ pipelines: [pipeline] });
    const { result } = renderHook(() => usePipelines("ws-1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([pipeline]);
    expect(requestMock.mock.calls[0][0]).toContain("query Pipelines");
    expect(requestMock.mock.calls[0][1]).toEqual({ serverId: "ws-1" });
  });

  it("creates with the input as-is and invalidates that workspace's list", async () => {
    requestMock.mockResolvedValue({ createPipeline: pipeline });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useCreatePipelineMutation(), { wrapper });

    const input = {
      serverId: "ws-1",
      name: "Escalate urgent",
      trigger: { kind: PipelineTriggerKindGql.NEW_MESSAGE },
      actions: [{ commandId: "chat.pin" }],
    };
    await act(() => result.current.mutateAsync(input));

    expect(requestMock.mock.calls[0][0]).toContain("mutation CreatePipeline");
    expect(requestMock.mock.calls[0][1]).toEqual({ input });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.pipelines("ws-1") });
  });

  it("updates and invalidates the list of the workspace returned by the server", async () => {
    requestMock.mockResolvedValue({ updatePipeline: { ...pipeline, serverId: "ws-9" } });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useUpdatePipelineMutation(), { wrapper });

    await act(() => result.current.mutateAsync({ pipelineId: "p-1", name: "Renamed" }));

    expect(requestMock.mock.calls[0][0]).toContain("mutation UpdatePipeline");
    expect(requestMock.mock.calls[0][1]).toEqual({
      input: { pipelineId: "p-1", name: "Renamed" },
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.pipelines("ws-9") });
  });

  it("deletes by id only and invalidates the workspace list", async () => {
    requestMock.mockResolvedValue({ deletePipeline: true });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useDeletePipelineMutation(), { wrapper });

    await act(() => result.current.mutateAsync({ pipelineId: "p-1", serverId: "ws-1" }));

    expect(requestMock.mock.calls[0][0]).toContain("mutation DeletePipeline");
    expect(requestMock.mock.calls[0][1]).toEqual({ pipelineId: "p-1" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.pipelines("ws-1") });
  });

  it("toggles with the target state and invalidates the workspace list", async () => {
    requestMock.mockResolvedValue({ togglePipeline: { ...pipeline, enabled: false } });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useTogglePipelineMutation(), { wrapper });

    await act(() =>
      result.current.mutateAsync({ pipelineId: "p-1", enabled: false, serverId: "ws-1" }),
    );

    expect(requestMock.mock.calls[0][0]).toContain("mutation TogglePipeline");
    expect(requestMock.mock.calls[0][1]).toEqual({ pipelineId: "p-1", enabled: false });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.pipelines("ws-1") });
  });

  it("does not invalidate when a mutation fails", async () => {
    requestMock.mockRejectedValue(new Error("boom"));
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useDeletePipelineMutation(), { wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ pipelineId: "p-1", serverId: "ws-1" }),
      ).rejects.toThrow("boom");
    });
    expect(invalidate).not.toHaveBeenCalled();
  });
});
