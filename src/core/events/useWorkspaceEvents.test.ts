import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
import { useShellStore } from "../../shell/state/useShellStore";
import { useAuthStore } from "../../features/auth/state/useAuthStore";
import { useMembersPanelStore } from "../../features/conversations/state/useMembersPanelStore";
import { markLeaving, clearLeaving } from "../../features/conversations/state/pendingLeaves";
import { makeConversation } from "../../features/conversations/__fixtures__/conversations";
import type { ConversationSummaryPage } from "../../features/conversations/types";
import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";
import { useMemberDirectoryStore } from "../../features/workspaces/state/useMemberDirectoryStore";
import { ServerMemberRoleGql } from "../graphql/generated/schema-types";
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

describe("useWorkspaceEvents conversation membership and archive", () => {
  const secret = makeConversation({ id: "c-secret", title: "secret", isPrivate: true });
  const general = makeConversation({ id: "c-general", title: "general" });

  function pageOf(...items: ReturnType<typeof makeConversation>[]): ConversationSummaryPage {
    return { items, pageInfo: { hasNext: false, hasPrev: false } };
  }

  function setup() {
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.joinedChannels("ws-1"), pageOf(general, secret));
    qc.setQueryData(queryKeys.conversations("ws-1"), pageOf());
    const spy = vi.spyOn(qc, "invalidateQueries");
    renderHook(() => useWorkspaceEvents("ws-1"), { wrapper: wrapperFor(qc) });
    return { qc, spy };
  }

  function joinedIds(qc: QueryClient) {
    return qc
      .getQueryData<ConversationSummaryPage>(queryKeys.joinedChannels("ws-1"))
      ?.items.map((c) => c.id);
  }

  beforeEach(() => {
    connectedHandler = null;
    subscribeObserver = null;
    vi.clearAllMocks();
    useShellStore.getState().reset();
    useAuthStore.setState({ session: { userId: "me" } });
    useMembersPanelStore.setState({ open: false });
  });

  afterEach(() => {
    useAuthStore.setState({ session: null });
    useShellStore.getState().reset();
  });

  it("removal of the viewer drops the conversation and leaves it when open, with a toast", () => {
    const { qc } = setup();
    useShellStore.setState({ selectedConversationId: "c-secret" });
    useMembersPanelStore.setState({ open: true });

    emitWorkspaceEvent({
      type: "MemberRemovedFromConversation",
      workspace_id: "ws-1",
      conversation_id: "c-secret",
      user_id: "me",
    });

    expect(joinedIds(qc)).toEqual(["c-general"]);
    expect(useShellStore.getState().selectedConversationId).toBeNull();
    expect(useMembersPanelStore.getState().open).toBe(false);
    expect(toast.info).toHaveBeenCalledWith("You are no longer a member of #secret");
  });

  it("removal of the viewer from a conversation that is not open only drops it", () => {
    const { qc } = setup();
    useShellStore.setState({ selectedConversationId: "c-general" });

    emitWorkspaceEvent({
      type: "MemberRemovedFromConversation",
      workspace_id: "ws-1",
      conversation_id: "c-secret",
      user_id: "me",
    });

    expect(joinedIds(qc)).toEqual(["c-general"]);
    expect(useShellStore.getState().selectedConversationId).toBe("c-general");
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("a voluntary leave does not also show the removal toast", () => {
    setup();
    useShellStore.setState({ selectedConversationId: "c-secret" });
    markLeaving("c-secret");
    try {
      emitWorkspaceEvent({
        type: "MemberRemovedFromConversation",
        workspace_id: "ws-1",
        conversation_id: "c-secret",
        user_id: "me",
      });
    } finally {
      clearLeaving("c-secret");
    }
    expect(useShellStore.getState().selectedConversationId).toBeNull();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("removal of someone else refreshes the members and lists but keeps the conversation", () => {
    const { qc, spy } = setup();
    useShellStore.setState({ selectedConversationId: "c-secret" });

    emitWorkspaceEvent({
      type: "MemberRemovedFromConversation",
      workspace_id: "ws-1",
      conversation_id: "c-secret",
      user_id: "u-alice",
    });

    expect(joinedIds(qc)).toEqual(["c-general", "c-secret"]);
    expect(useShellStore.getState().selectedConversationId).toBe("c-secret");
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.conversation("ws-1", "c-secret") });
  });

  it("the viewer being added refetches the joined channel list", () => {
    const { spy } = setup();
    emitWorkspaceEvent({
      type: "MemberAddedToConversation",
      workspace_id: "ws-1",
      conversation_id: "c-new",
      user_id: "me",
    });
    // The `channels` prefix covers the joined list.
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.channels("ws-1") });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.conversations("ws-1") });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.conversation("ws-1", "c-new") });
  });

  it("ConversationUpdated refetches the conversation and the channel lists", () => {
    const { spy } = setup();
    emitWorkspaceEvent({
      type: "ConversationUpdated",
      workspace_id: "ws-1",
      conversation_id: "c-general",
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.conversation("ws-1", "c-general") });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.channels("ws-1") });
  });
});

describe("useWorkspaceEvents workspace roles and removal (Track 1.2)", () => {
  function setup() {
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.server("ws-1"), {
      id: "ws-1",
      name: "Acme",
      viewerRole: ServerMemberRoleGql.MEMBER,
    });
    qc.setQueryData(queryKeys.myServers(), [
      { id: "ws-1", name: "Acme" },
      { id: "ws-2", name: "Beta" },
    ]);
    const spy = vi.spyOn(qc, "invalidateQueries");
    renderHook(() => useWorkspaceEvents("ws-1"), { wrapper: wrapperFor(qc) });
    return { qc, spy };
  }

  beforeEach(() => {
    connectedHandler = null;
    subscribeObserver = null;
    vi.clearAllMocks();
    useShellStore.getState().reset();
    useAuthStore.setState({ session: { userId: "me" } });
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useMembersPanelStore.setState({ open: false });
    useMemberDirectoryStore.setState({ open: false });
  });

  afterEach(() => {
    useAuthStore.setState({ session: null });
    useWorkspaceStore.setState({ workspaceId: null });
    useShellStore.getState().reset();
  });

  it("MemberRoleChanged for someone else refetches the member directory only", () => {
    const { qc, spy } = setup();
    emitWorkspaceEvent({
      type: "MemberRoleChanged",
      workspace_id: "ws-1",
      user_id: "u-alice",
      role: "moderator",
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.serverMembers("ws-1") });
    expect(spy).not.toHaveBeenCalledWith({ queryKey: queryKeys.server("ws-1") });
    expect(qc.getQueryData<{ viewerRole: string }>(queryKeys.server("ws-1"))?.viewerRole).toBe(
      ServerMemberRoleGql.MEMBER,
    );
  });

  it("MemberRoleChanged for the viewer patches and refetches their role and role-shaped lists", () => {
    const { qc, spy } = setup();
    emitWorkspaceEvent({
      type: "MemberRoleChanged",
      workspace_id: "ws-1",
      user_id: "me",
      role: "guest",
    });
    // The guest UI re-evaluates at once from the patched cache.
    expect(qc.getQueryData<{ viewerRole: string }>(queryKeys.server("ws-1"))?.viewerRole).toBe(
      ServerMemberRoleGql.GUEST,
    );
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.serverMembers("ws-1") });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.server("ws-1") });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.channels("ws-1") });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.conversations("ws-1") });
  });

  it("MemberLeft for someone else refetches the member directory and stays put", () => {
    const { spy } = setup();
    emitWorkspaceEvent({ type: "MemberLeft", workspace_id: "ws-1", user_id: "u-alice" });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.serverMembers("ws-1") });
    expect(useWorkspaceStore.getState().workspaceId).toBe("ws-1");
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("MemberLeft for the viewer leaves the workspace with a toast and refetches myServers", () => {
    useShellStore.setState({ selectedConversationId: "c-general" });
    useMembersPanelStore.setState({ open: true });
    useMemberDirectoryStore.setState({ open: true });
    const { qc, spy } = setup();
    emitWorkspaceEvent({ type: "MemberLeft", workspace_id: "ws-1", user_id: "me" });

    expect(useWorkspaceStore.getState().workspaceId).toBeNull();
    expect(useShellStore.getState().selectedConversationId).toBeNull();
    expect(useMembersPanelStore.getState().open).toBe(false);
    expect(useMemberDirectoryStore.getState().open).toBe(false);
    expect(qc.getQueryData<{ id: string }[]>(queryKeys.myServers())?.map((s) => s.id)).toEqual([
      "ws-2",
    ]);
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.myServers() });
    expect(toast.info).toHaveBeenCalledWith("You were removed from this workspace");
  });
});

describe("useWorkspaceEvents encrypted conversations", () => {
  beforeEach(() => {
    subscribeObserver = null;
    vi.clearAllMocks();
  });

  it("does not put an encrypted message's empty text into the timeline", () => {
    const qc = new QueryClient();
    const key = queryKeys.messages("ws-1", "c-enc");
    qc.setQueryData(key, {
      pages: [{ items: [], next: null, prev: null, pageInfo: { hasNext: false, hasPrev: false } }],
      pageParams: [null],
    });
    renderHook(() => useWorkspaceEvents("ws-1"), { wrapper: wrapperFor(qc) });

    emitWorkspaceEvent({
      type: "NewMessage",
      workspace_id: "ws-1",
      conversation_id: "c-enc",
      message: {
        id: "m-1",
        server_id: "ws-1",
        conversation_id: "c-enc",
        thread_id: null,
        root_thread_id: null,
        author_id: "u-2",
        text: null,
        has_attachments: false,
        parent_message_id: null,
        forwarded_from_message_id: null,
        is_deleted: false,
        sent_at: "2026-10-09T10:00:00Z",
        reactions: [],
        encryption: {
          incarnation: 1,
          epoch: 2,
          sender_device_id: "d-2",
          ciphertext: "AAEC",
          franking_receipt: "cmVjZWlwdA",
          franking_key_id: 1,
          sent_at_us: "1791504000123456",
        },
      },
    });

    const data = qc.getQueryData<{ pages: { items: unknown[] }[] }>(key);
    expect(data?.pages[0].items).toEqual([]);
  });
});
