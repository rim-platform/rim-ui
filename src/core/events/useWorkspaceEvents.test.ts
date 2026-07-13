import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { queryKeys, VOLATILE_WORKSPACE_KEY_ROOTS, VOLATILE_GLOBAL_KEY_ROOTS } from "../query/keys";
import type { WorkspaceEvent } from "./types";

let connectedHandler: (() => void) | null = null;
let subscribeObserver: { next: (result: { data?: { workspaceEvents: string } }) => void } | null =
  null;

vi.mock("../graphql/wsClient", () => ({
  wsClient: {
    subscribe: vi.fn(
      (
        _request: unknown,
        observer: { next: (result: { data?: { workspaceEvents: string } }) => void },
      ) => {
        subscribeObserver = observer;
        return () => {};
      },
    ),
  },
  onWsConnected: vi.fn((handler: () => void) => {
    connectedHandler = handler;
    return () => {
      connectedHandler = null;
    };
  }),
}));

vi.mock("../../shared/toast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  },
}));

const ackMutateMock = vi.fn();
vi.mock("../../features/commands/api/useCommands", () => ({
  useExecuteCommandMutation: () => ({ mutate: ackMutateMock }),
}));

import { toast } from "../../shared/toast";
import { useWorkspaceEvents } from "./useWorkspaceEvents";

/** Simulates the backend pushing a `WorkspaceEvent` down the subscription. */
function emitWorkspaceEvent(event: WorkspaceEvent) {
  subscribeObserver?.next({ data: { workspaceEvents: JSON.stringify(event) } });
}

function wrapperFor(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

describe("useWorkspaceEvents reconnect invalidation", () => {
  beforeEach(() => {
    connectedHandler = null;
    subscribeObserver = null;
    vi.clearAllMocks();
  });

  it("does not invalidate anything on the first (initial) connect", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");

    renderHook(() => useWorkspaceEvents("ws-1"), { wrapper: wrapperFor(qc) });
    connectedHandler?.();

    expect(spy).not.toHaveBeenCalled();
  });

  it("invalidates every volatile workspace root and global root on reconnect, scoped to the active workspace", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");

    renderHook(() => useWorkspaceEvents("ws-1"), { wrapper: wrapperFor(qc) });
    connectedHandler?.(); // initial connect — skipped
    connectedHandler?.(); // reconnect

    for (const root of VOLATILE_WORKSPACE_KEY_ROOTS) {
      expect(spy).toHaveBeenCalledWith({ queryKey: [root, "ws-1"] });
    }
    for (const root of VOLATILE_GLOBAL_KEY_ROOTS) {
      expect(spy).toHaveBeenCalledWith({ queryKey: [root] });
    }
    expect(spy).toHaveBeenCalledTimes(
      VOLATILE_WORKSPACE_KEY_ROOTS.length + VOLATILE_GLOBAL_KEY_ROOTS.length,
    );
    // Never a blanket, unfiltered invalidation.
    for (const call of spy.mock.calls) {
      expect(call[0]).toBeDefined();
      expect(Array.isArray((call[0] as { queryKey?: unknown }).queryKey)).toBe(true);
    }
  });

  it("invalidates nothing on reconnect when there is no active workspace", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");

    renderHook(() => useWorkspaceEvents(null), { wrapper: wrapperFor(qc) });
    connectedHandler?.(); // initial connect — skipped
    connectedHandler?.(); // reconnect, but no workspace to scope to

    expect(spy).not.toHaveBeenCalled();
  });
});

describe("useWorkspaceEvents incident event handling", () => {
  beforeEach(() => {
    connectedHandler = null;
    subscribeObserver = null;
    ackMutateMock.mockReset();
    vi.clearAllMocks();
  });

  it("IncidentDeclared invalidates the three incident keys and toasts", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");

    renderHook(() => useWorkspaceEvents("ws-1"), { wrapper: wrapperFor(qc) });
    emitWorkspaceEvent({
      type: "IncidentDeclared",
      workspace_id: "ws-1",
      conversation_id: "conv-1",
      conversation_type: "CHANNEL",
      incident_id: "inc-1",
      severity: "SEV_2",
      title: "Payments API down",
    });

    expect(spy).toHaveBeenCalledWith({
      queryKey: queryKeys.activeIncident("ws-1", "conv-1"),
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["listIncidents", "ws-1"] });
    expect(spy).toHaveBeenCalledWith({
      queryKey: queryKeys.incidentTimeline("inc-1"),
    });
    expect(toast.info).toHaveBeenCalledWith(
      "Incident declared: Payments API down",
      expect.objectContaining({ description: expect.stringContaining("SEV_2") }),
    );
  });

  it("IncidentDeclared with a null severity omits the severity from the toast description", () => {
    const qc = new QueryClient();
    renderHook(() => useWorkspaceEvents("ws-1"), { wrapper: wrapperFor(qc) });

    emitWorkspaceEvent({
      type: "IncidentDeclared",
      workspace_id: "ws-1",
      conversation_id: "conv-1",
      conversation_type: "DIRECT",
      incident_id: "inc-1",
      severity: null,
      title: "Unknown severity incident",
    });

    expect(toast.info).toHaveBeenCalledWith(
      "Incident declared: Unknown severity incident",
      expect.objectContaining({ description: undefined }),
    );
  });

  it("IncidentUpdated invalidates the three incident keys without a duplicate toast", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");

    renderHook(() => useWorkspaceEvents("ws-1"), { wrapper: wrapperFor(qc) });
    emitWorkspaceEvent({
      type: "IncidentUpdated",
      workspace_id: "ws-1",
      conversation_id: "conv-1",
      conversation_type: "CHANNEL",
      incident_id: "inc-1",
      status: "RESOLVED",
    });

    expect(spy).toHaveBeenCalledWith({
      queryKey: queryKeys.activeIncident("ws-1", "conv-1"),
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["listIncidents", "ws-1"] });
    expect(spy).toHaveBeenCalledWith({
      queryKey: queryKeys.incidentTimeline("inc-1"),
    });
    expect(toast.info).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("EscalationStepFired invalidates the three incident keys and shows a paged toast when the current user is targeted", () => {
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.me, { id: "u1" });
    const spy = vi.spyOn(qc, "invalidateQueries");

    renderHook(() => useWorkspaceEvents("ws-1"), { wrapper: wrapperFor(qc) });
    emitWorkspaceEvent({
      type: "EscalationStepFired",
      workspace_id: "ws-1",
      conversation_id: "conv-1",
      conversation_type: "CHANNEL",
      incident_id: "inc-1",
      escalation_policy_id: "policy-1",
      step_index: 1,
      target_user_ids: ["u1", "u2"],
    });

    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.activeIncident("ws-1", "conv-1") });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["listIncidents", "ws-1"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.incidentTimeline("inc-1") });
    expect(toast.warning).toHaveBeenCalledWith(
      "You're being paged for an incident",
      expect.objectContaining({ id: "paged-inc-1", persistent: true }),
    );
  });

  it("EscalationStepFired does NOT show a paged toast when the current user isn't targeted", () => {
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.me, { id: "u9" });

    renderHook(() => useWorkspaceEvents("ws-1"), { wrapper: wrapperFor(qc) });
    emitWorkspaceEvent({
      type: "EscalationStepFired",
      workspace_id: "ws-1",
      conversation_id: "conv-1",
      conversation_type: "CHANNEL",
      incident_id: "inc-1",
      escalation_policy_id: "policy-1",
      step_index: 0,
      target_user_ids: ["u1", "u2"],
    });

    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("the paged toast's inline Ack action dispatches the incident.ack command", () => {
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.me, { id: "u1" });

    renderHook(() => useWorkspaceEvents("ws-1"), { wrapper: wrapperFor(qc) });
    emitWorkspaceEvent({
      type: "EscalationStepFired",
      workspace_id: "ws-1",
      conversation_id: "conv-1",
      conversation_type: "CHANNEL",
      incident_id: "inc-1",
      escalation_policy_id: "policy-1",
      step_index: 0,
      target_user_ids: ["u1"],
    });

    const call = vi.mocked(toast.warning).mock.calls[0];
    const options = call[1] as { action: { onClick: () => void } };
    options.action.onClick();

    expect(ackMutateMock).toHaveBeenCalledWith(
      { commandId: "incident.ack", args: { incidentId: "inc-1" } },
      expect.anything(),
    );
  });

  it("IncidentAcknowledged invalidates the three incident keys and dismisses the paged toast", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");

    renderHook(() => useWorkspaceEvents("ws-1"), { wrapper: wrapperFor(qc) });
    emitWorkspaceEvent({
      type: "IncidentAcknowledged",
      workspace_id: "ws-1",
      conversation_id: "conv-1",
      conversation_type: "CHANNEL",
      incident_id: "inc-1",
      acknowledged_by: "u1",
    });

    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.activeIncident("ws-1", "conv-1") });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["listIncidents", "ws-1"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.incidentTimeline("inc-1") });
    expect(toast.dismiss).toHaveBeenCalledWith("paged-inc-1");
  });

  it("an unrecognized event shape is a silent no-op (defensive JSON.parse + switch, no throw)", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");

    renderHook(() => useWorkspaceEvents("ws-1"), { wrapper: wrapperFor(qc) });

    expect(() =>
      subscribeObserver?.next({
        data: { workspaceEvents: JSON.stringify({ type: "SomeFutureEventType", foo: "bar" }) },
      }),
    ).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });
});
