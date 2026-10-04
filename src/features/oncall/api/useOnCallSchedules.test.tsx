import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { RotationKindGql } from "../../../core/graphql/generated/schema-types";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

import {
  useOnCallSchedules,
  useCreateOnCallSchedule,
  useUpdateOnCallSchedule,
  useDeleteOnCallSchedule,
  useAddRotationLayer,
  useSetRotationParticipants,
  useCreateOnCallOverride,
  useDeleteOnCallOverride,
} from "./useOnCallSchedules";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const sampleSchedule = {
  id: "sched-1",
  serverId: "srv-1",
  name: "Primary",
  timezone: "UTC",
  createdBy: "u1",
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
};

describe("useOnCallSchedules", () => {
  beforeEach(() => requestMock.mockReset());

  it("is disabled without a serverId", () => {
    renderHook(() => useOnCallSchedules(undefined), { wrapper });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("fetches and returns the schedule list", async () => {
    requestMock.mockResolvedValue({ onCallSchedules: [sampleSchedule] });
    const { result } = renderHook(() => useOnCallSchedules("srv-1"), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([sampleSchedule]));
    expect(requestMock.mock.calls[0][1]).toEqual({ serverId: "srv-1" });
  });
});

describe("useCreateOnCallSchedule", () => {
  beforeEach(() => requestMock.mockReset());

  it("creates a schedule and invalidates the list for its server", async () => {
    requestMock.mockResolvedValue({ createOnCallSchedule: sampleSchedule });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useCreateOnCallSchedule(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      ),
    });

    await act(async () => {
      await result.current.mutateAsync({ serverId: "srv-1", name: "Primary", timezone: "UTC" });
    });

    expect(requestMock.mock.calls[0][1]).toEqual({
      serverId: "srv-1",
      name: "Primary",
      timezone: "UTC",
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["onCallSchedules", "srv-1"] });
  });
});

describe("useUpdateOnCallSchedule / useDeleteOnCallSchedule", () => {
  beforeEach(() => requestMock.mockReset());

  it("update invalidates the schedule list using the caller-supplied serverId", async () => {
    requestMock.mockResolvedValue({ updateOnCallSchedule: sampleSchedule });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useUpdateOnCallSchedule(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      ),
    });

    await act(async () => {
      await result.current.mutateAsync({ serverId: "srv-1", scheduleId: "sched-1", name: "New" });
    });

    expect(spy).toHaveBeenCalledWith({ queryKey: ["onCallSchedules", "srv-1"] });
  });

  it("delete invalidates the schedule list using the caller-supplied serverId", async () => {
    requestMock.mockResolvedValue({ deleteOnCallSchedule: true });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useDeleteOnCallSchedule(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      ),
    });

    await act(async () => {
      await result.current.mutateAsync({ serverId: "srv-1", scheduleId: "sched-1" });
    });

    expect(spy).toHaveBeenCalledWith({ queryKey: ["onCallSchedules", "srv-1"] });
  });
});

describe("useAddRotationLayer / useSetRotationParticipants", () => {
  beforeEach(() => requestMock.mockReset());

  it("adds a rotation layer with the given kind", async () => {
    const layer = {
      id: "layer-1",
      scheduleId: "sched-1",
      name: "Primary",
      priority: 0,
      kind: RotationKindGql.WEEKLY,
      handoffTime: "09:00:00",
      handoffWeekday: 0,
      intervalSeconds: null,
      anchorAt: "2026-07-01T09:00:00Z",
      createdAt: "2026-07-01T00:00:00Z",
      participants: [],
    };
    requestMock.mockResolvedValue({ addRotationLayer: layer });
    const { result } = renderHook(() => useAddRotationLayer(), { wrapper });

    const returned = await result.current.mutateAsync({
      scheduleId: "sched-1",
      name: "Primary",
      priority: 0,
      kind: { kind: RotationKindGql.WEEKLY, handoffTime: "09:00:00", handoffWeekday: 0 },
      anchorAt: "2026-07-01T09:00:00Z",
    });

    expect(returned).toEqual(layer);
    expect(requestMock.mock.calls[0][1]).toMatchObject({ scheduleId: "sched-1", name: "Primary" });
  });

  it("replaces the ordered participant list", async () => {
    requestMock.mockResolvedValue({
      setRotationParticipants: { id: "layer-1", participants: ["u1", "u2"] },
    });
    const { result } = renderHook(() => useSetRotationParticipants(), { wrapper });
    await result.current.mutateAsync({ layerId: "layer-1", userIds: ["u1", "u2"] });
    expect(requestMock.mock.calls[0][1]).toEqual({ layerId: "layer-1", userIds: ["u1", "u2"] });
  });
});

describe("useCreateOnCallOverride / useDeleteOnCallOverride", () => {
  beforeEach(() => requestMock.mockReset());

  it("creates an override and invalidates the schedule's shift/who-is-on-call caches", async () => {
    const override = {
      id: "ov-1",
      scheduleId: "sched-1",
      userId: "u1",
      startAt: "2026-07-08T00:00:00Z",
      endAt: "2026-07-09T00:00:00Z",
      createdBy: "u1",
    };
    requestMock.mockResolvedValue({ createOnCallOverride: override });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useCreateOnCallOverride(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      ),
    });

    await act(async () => {
      await result.current.mutateAsync({
        scheduleId: "sched-1",
        userId: "u1",
        startAt: "2026-07-08T00:00:00Z",
        endAt: "2026-07-09T00:00:00Z",
      });
    });

    expect(spy).toHaveBeenCalledWith({ queryKey: ["onCallShifts", "sched-1"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["whoIsOnCall", "sched-1"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["serverOnCall"] });
  });

  it("deletes an override and invalidates the schedule's shift/who-is-on-call caches", async () => {
    requestMock.mockResolvedValue({ deleteOnCallOverride: true });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useDeleteOnCallOverride(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      ),
    });

    await act(async () => {
      await result.current.mutateAsync({ overrideId: "ov-1", scheduleId: "sched-1" });
    });

    expect(spy).toHaveBeenCalledWith({ queryKey: ["onCallShifts", "sched-1"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["whoIsOnCall", "sched-1"] });
  });
});
