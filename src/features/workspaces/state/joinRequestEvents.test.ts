import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

import type { WorkspaceEvent } from "../../../core/events/types";

const remote = vi.hoisted(() => ({
  joinAsMember: vi.fn(),
  refreshWorkspaceDetails: vi.fn(async () => undefined),
}));
vi.mock("../../relay/remote/remoteWorkspaces", () => remote);
vi.mock("../../../shared/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));
vi.mock("../../../core/runtime/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../core/runtime/runtime")>()),
  detectPlatform: () => "web",
}));
vi.mock("../../notifications/runtime/browserNotification", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../notifications/runtime/browserNotification")>()),
  showBrowserTextNotification: () => false,
}));

import { toast } from "../../../shared/toast";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useNotificationSettingsStore } from "../../notifications/state/useNotificationSettingsStore";
import {
  addPendingRemoteJoin,
  pendingRemoteJoinAt,
  type PendingRemoteJoin,
} from "../../relay/remote/pendingRemoteJoins";
import { useRelayStore } from "../../relay/state/useRelayStore";
import { handleRemoteJoinDecided } from "./joinRequestEvents";

const HOST = "rims1_host";
const entry: PendingRemoteJoin = {
  hostServerId: HOST,
  hostOrigin: "https://host.example",
  workspaceId: "ws-acme",
  workspaceName: "Acme",
  joinRequestId: "jr-1",
  expiresAt: Date.now() + 24 * 60 * 60 * 1000,
};

type Decided = Extract<WorkspaceEvent, { type: "JoinRequestDecided" }>;

/** The decision as the host sends it: `user_id` is the person's id at the host. */
function decided(outcome: Decided["outcome"], workspaceId = "ws-acme"): Decided {
  return {
    type: "JoinRequestDecided",
    workspace_id: workspaceId,
    request_id: "jr-1",
    user_id: "r_person_at_host",
    outcome,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  // This account's own id is not the one the host knows the person by.
  useAuthStore.setState({ session: { userId: "u-local" } });
  useNotificationSettingsStore.setState({ enabled: true, soundEnabled: true });
  useRelayStore.setState({
    account: {
      endpoint: "http://localhost:8080/api",
      userId: "u-local",
      principalId: "rimp1_me",
      deviceId: "d-1",
    },
  });
  addPendingRemoteJoin(entry);
  remote.joinAsMember.mockResolvedValue({
    outcome: "JOINED",
    hostServerId: HOST,
    workspaceId: "ws-acme",
    role: "member",
  });
});

afterEach(() => {
  useAuthStore.setState({ session: null });
  useRelayStore.getState().reset();
  localStorage.clear();
});

describe("handleRemoteJoinDecided", () => {
  it("finishes the join as a member when accepted, then notifies", async () => {
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    await handleRemoteJoinDecided(qc, HOST, decided("accepted"));
    expect(remote.joinAsMember).toHaveBeenCalledWith(entry);
    expect(remote.refreshWorkspaceDetails).toHaveBeenCalledWith("ws-acme");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["remoteSubscriptions"] });
    expect(pendingRemoteJoinAt(HOST, "ws-acme")).toBeNull();
    expect(toast.success).toHaveBeenCalledWith("Your request to join Acme was accepted.", {
      description: "The workspace is in your workspace list now.",
    });
  });

  it("notifies a decline without joining", async () => {
    await handleRemoteJoinDecided(new QueryClient(), HOST, decided("declined"));
    expect(remote.joinAsMember).not.toHaveBeenCalled();
    expect(pendingRemoteJoinAt(HOST, "ws-acme")).toBeNull();
    expect(toast.info).toHaveBeenCalledWith("Your request to join Acme was declined.", {
      description: "You can ask to join it again in 24 hours.",
    });
  });

  it("forgets a cancelled request quietly", async () => {
    await handleRemoteJoinDecided(new QueryClient(), HOST, decided("cancelled"));
    expect(remote.joinAsMember).not.toHaveBeenCalled();
    expect(pendingRemoteJoinAt(HOST, "ws-acme")).toBeNull();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("matches by the kept request, not by the event's user", async () => {
    await handleRemoteJoinDecided(new QueryClient(), "rims1_other", decided("accepted"));
    await handleRemoteJoinDecided(new QueryClient(), HOST, decided("accepted", "ws-other"));
    expect(remote.joinAsMember).not.toHaveBeenCalled();
    expect(pendingRemoteJoinAt(HOST, "ws-acme")).toEqual(entry);
  });

  it("says so when joining after an acceptance fails", async () => {
    remote.joinAsMember.mockRejectedValue(new Error("the host is unreachable"));
    await handleRemoteJoinDecided(new QueryClient(), HOST, decided("accepted"));
    expect(pendingRemoteJoinAt(HOST, "ws-acme")).toBeNull();
    expect(remote.refreshWorkspaceDetails).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "Your request to join Acme was accepted, but joining it failed.",
      { description: "Paste its link under Add workspace to join." },
    );
    expect(toast.success).not.toHaveBeenCalled();
  });
});
