import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { WorkspaceEvent } from "../../../core/events/types";
import { JoinRequestStatus } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import type { JoinRequestRow } from "../api/publicLink";

interface Observer {
  next: (result: { data?: { workspaceEvents: string } }) => void;
}

let subscribed: { workspaceId: unknown; observer: Observer } | null = null;

vi.mock("../../../core/graphql/wsClient", () => ({
  wsClient: {
    subscribe: vi.fn((request: { variables: { workspaceId: unknown } }, observer: Observer) => {
      subscribed = { workspaceId: request.variables.workspaceId, observer };
      return () => {};
    }),
  },
  onWsConnected: vi.fn(() => () => {}),
}));
vi.mock("../../../shared/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));
const platform = vi.hoisted(() => ({ value: "web" as "web" | "desktop" }));
vi.mock("../../../core/runtime/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../core/runtime/runtime")>()),
  detectPlatform: () => platform.value,
}));
const showDesktopNotification = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("../../notifications/runtime/desktopNotification", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../notifications/runtime/desktopNotification")>()),
  showDesktopNotification,
}));

import { toast } from "../../../shared/toast";
import { useWorkspaceEvents } from "../../../core/events/useWorkspaceEvents";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useNotificationSettingsStore } from "../../notifications/state/useNotificationSettingsStore";
import { DIRECT_SPACE_ID } from "../../../test/directSpace";

const ME = "u1";

const mine: JoinRequestRow = {
  id: "jr-1",
  serverId: "ws-acme",
  workspaceName: "Acme Community",
  userId: ME,
  message: null,
  status: JoinRequestStatus.OPEN,
  createdAt: "2026-10-23T10:00:00Z",
  expiresAt: "2026-11-22T10:00:00Z",
  user: null,
};

function decided(outcome: string, userId = ME): WorkspaceEvent {
  return {
    type: "JoinRequestDecided",
    workspace_id: "ws-acme",
    request_id: "jr-1",
    user_id: userId,
    outcome,
  } as WorkspaceEvent;
}

/** Subscribes to this relay's direct space, as a signed-in client keeps open. */
function listenOnDirectSpace(qc: QueryClient) {
  renderHook(() => useWorkspaceEvents(DIRECT_SPACE_ID), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children),
  });
  expect(subscribed?.workspaceId).toBe(DIRECT_SPACE_ID);
}

function emit(event: WorkspaceEvent) {
  subscribed?.observer.next({ data: { workspaceEvents: JSON.stringify(event) } });
}

function clientWithMyRequest() {
  const qc = new QueryClient();
  qc.setQueryData(queryKeys.myJoinRequests, [mine]);
  return qc;
}

describe("join request events on the direct-space subscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    subscribed = null;
    platform.value = "web";
    useAuthStore.setState({ session: { userId: ME } });
    useNotificationSettingsStore.setState({ enabled: true, soundEnabled: true });
  });

  afterEach(() => useAuthStore.setState({ session: null }));

  it("tells the person their request was accepted and refreshes their workspaces", async () => {
    const qc = clientWithMyRequest();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    listenOnDirectSpace(qc);

    emit(decided("accepted"));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Your request to join Acme Community was accepted",
        { description: "The workspace is in your workspace list now." },
      ),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.myServers() });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.myJoinRequests });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["publicJoinLinkPreview"] });
    // Acts on the workspace asked to join, not on the direct space it arrived on.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["joinRequests", "ws-acme"] });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ["joinRequests", DIRECT_SPACE_ID] });
  });

  it("tells the person their request was declined, without touching their workspaces", async () => {
    const qc = clientWithMyRequest();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    listenOnDirectSpace(qc);

    emit(decided("declined"));

    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith("Your request to join Acme Community was declined", {
        description: "You can ask to join it again in 24 hours.",
      }),
    );
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: queryKeys.myServers() });
  });

  it("names the workspace from the link page when the request list is not cached", async () => {
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.publicJoinLinkPreview("rim_pjl_x", ME), {
      serverId: "ws-acme",
      name: "Acme from the link",
      mode: "REQUESTS",
      viewer: "REQUEST_OPEN",
      joinRequestId: "jr-1",
    });
    listenOnDirectSpace(qc);

    emit(decided("declined"));

    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith(
        "Your request to join Acme from the link was declined",
        expect.anything(),
      ),
    );
  });

  it("still notifies when the workspace's name is not known here", async () => {
    const qc = new QueryClient();
    listenOnDirectSpace(qc);
    emit(decided("declined"));
    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith(
        "Your request to join a workspace was declined",
        expect.anything(),
      ),
    );
  });

  it.each(["withdrawn", "cancelled"])("says nothing when a request is %s", async (outcome) => {
    const qc = clientWithMyRequest();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    listenOnDirectSpace(qc);

    emit(decided(outcome));

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.myJoinRequests }),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
    expect(showDesktopNotification).not.toHaveBeenCalled();
  });

  it("says nothing about someone else's request", async () => {
    const qc = clientWithMyRequest();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    listenOnDirectSpace(qc);

    emit(decided("accepted", "u-other"));

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["joinRequests", "ws-acme"] }),
    );
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: queryKeys.myServers() });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("follows the device's notification switch", async () => {
    useNotificationSettingsStore.setState({ enabled: false });
    const qc = clientWithMyRequest();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    listenOnDirectSpace(qc);

    emit(decided("accepted"));

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.myServers() }),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(showDesktopNotification).not.toHaveBeenCalled();
  });

  it("shows a desktop notification in the desktop app, with the device's sound setting", async () => {
    platform.value = "desktop";
    useNotificationSettingsStore.setState({ soundEnabled: false });
    listenOnDirectSpace(clientWithMyRequest());

    emit(decided("accepted"));

    await waitFor(() =>
      expect(showDesktopNotification).toHaveBeenCalledWith({
        title: "Your request to join Acme Community was accepted",
        body: "The workspace is in your workspace list now.",
        sound: false,
      }),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("refreshes the person's requests when they asked from another device", async () => {
    const qc = clientWithMyRequest();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    listenOnDirectSpace(qc);

    emit({
      type: "JoinRequestCreated",
      workspace_id: "ws-acme",
      request_id: "jr-2",
      user_id: ME,
    });

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.myJoinRequests }),
    );
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("counts a join through the public link in the Owner's link statistics", async () => {
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    renderHook(() => useWorkspaceEvents("ws-acme"), {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client: qc }, children),
    });

    emit({
      type: "MemberJoined",
      workspace_id: "ws-acme",
      user_id: "u-new",
      username: "new",
      source: "public_link",
    });
    emit({ type: "MemberJoined", workspace_id: "ws-acme", user_id: "u-inv", username: "inv" });

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.publicJoinLink("ws-acme") }),
    );
    expect(
      invalidate.mock.calls.filter(
        ([filters]) =>
          JSON.stringify(filters) ===
          JSON.stringify({ queryKey: queryKeys.publicJoinLink("ws-acme") }),
      ),
    ).toHaveLength(1);
  });
});
