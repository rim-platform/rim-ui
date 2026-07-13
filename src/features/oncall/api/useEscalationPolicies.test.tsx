import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import {
  EscalationActionKindGql,
  EscalationTargetKindGql,
} from "../../../core/graphql/generated/schema-types";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

import {
  useEscalationPolicies,
  useCreateEscalationPolicy,
  useUpdateEscalationPolicy,
  useDeleteEscalationPolicy,
  useSetChannelEscalationPolicy,
} from "./useEscalationPolicies";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const samplePolicy = {
  id: "policy-1",
  serverId: "srv-1",
  name: "Default",
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
  steps: [
    {
      id: "step-1",
      policyId: "policy-1",
      position: 0,
      delaySeconds: 0,
      targetKind: EscalationTargetKindGql.ON_CALL,
      targetUserId: null,
      targetScheduleId: "sched-1",
      actions: [EscalationActionKindGql.MENTION_IN_CHANNEL],
    },
  ],
};

describe("useEscalationPolicies", () => {
  beforeEach(() => requestMock.mockReset());

  it("is disabled without a serverId", () => {
    renderHook(() => useEscalationPolicies(undefined), { wrapper });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("fetches the policy list with its steps", async () => {
    requestMock.mockResolvedValue({ escalationPolicies: [samplePolicy] });
    const { result } = renderHook(() => useEscalationPolicies("srv-1"), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([samplePolicy]));
    expect(requestMock.mock.calls[0][1]).toEqual({ serverId: "srv-1" });
  });
});

describe("useCreateEscalationPolicy", () => {
  beforeEach(() => requestMock.mockReset());

  it("creates a policy and invalidates the list for its server", async () => {
    requestMock.mockResolvedValue({ createEscalationPolicy: samplePolicy });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useCreateEscalationPolicy(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      ),
    });

    await act(async () => {
      await result.current.mutateAsync({
        serverId: "srv-1",
        name: "Default",
        steps: [
          {
            delaySeconds: 0,
            target: { kind: EscalationTargetKindGql.ON_CALL, scheduleId: "sched-1" },
            actions: [EscalationActionKindGql.MENTION_IN_CHANNEL],
          },
        ],
      });
    });

    expect(spy).toHaveBeenCalledWith({ queryKey: ["escalationPolicies", "srv-1"] });
  });
});

describe("useUpdateEscalationPolicy / useDeleteEscalationPolicy", () => {
  beforeEach(() => requestMock.mockReset());

  it("update invalidates the policy list using the caller-supplied serverId", async () => {
    requestMock.mockResolvedValue({ updateEscalationPolicy: samplePolicy });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useUpdateEscalationPolicy(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      ),
    });

    await act(async () => {
      await result.current.mutateAsync({ serverId: "srv-1", policyId: "policy-1", name: "New" });
    });

    expect(spy).toHaveBeenCalledWith({ queryKey: ["escalationPolicies", "srv-1"] });
  });

  it("delete invalidates the policy list using the caller-supplied serverId", async () => {
    requestMock.mockResolvedValue({ deleteEscalationPolicy: true });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useDeleteEscalationPolicy(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      ),
    });

    await act(async () => {
      await result.current.mutateAsync({ serverId: "srv-1", policyId: "policy-1" });
    });

    expect(spy).toHaveBeenCalledWith({ queryKey: ["escalationPolicies", "srv-1"] });
  });
});

describe("useSetChannelEscalationPolicy", () => {
  beforeEach(() => requestMock.mockReset());

  it("sends serverId/conversationId/policyId", async () => {
    requestMock.mockResolvedValue({ setChannelEscalationPolicy: true });
    const { result } = renderHook(() => useSetChannelEscalationPolicy(), { wrapper });

    await result.current.mutateAsync({
      serverId: "srv-1",
      conversationId: "conv-1",
      policyId: "policy-1",
    });

    expect(requestMock.mock.calls[0][1]).toEqual({
      serverId: "srv-1",
      conversationId: "conv-1",
      policyId: "policy-1",
    });
  });
});
