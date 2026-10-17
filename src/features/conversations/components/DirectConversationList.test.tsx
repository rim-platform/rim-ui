import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../test/utils";
import { useRelayStore } from "../../relay/state/useRelayStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";

const inbox = vi.hoisted(() => ({ fetchInboxConversations: vi.fn() }));
const relayApi = vi.hoisted(() => ({
  fetchConversationPredecessor: vi.fn(),
  fetchDmRequests: vi.fn(),
}));
vi.mock("../api/useInboxConversations", () => inbox);
vi.mock("../../relay/api/relayApi", () => relayApi);
vi.mock("../../workspaces/api/useServerMembers", () => ({
  useServerMembers: () => ({ data: [] }),
}));
vi.mock("../../workspaces/hooks/useMemberLookup", () => ({
  useMemberLookup: (serverId: string) => ({
    resolve: () => ({ displayName: serverId === "remote-space" ? "Alice" : "Carol" }),
    map: new Map(),
  }),
}));

import { makeDmRequest } from "../../relay/__fixtures__/dmRequests";
import { DirectConversationList } from "./DirectConversationList";

function dm(id: string, serverId: string) {
  return {
    id,
    serverId,
    title: null,
    conversationType: "DIRECT",
    memberIds: ["u1", "u2"],
    memberCount: 2,
    encryptedAt: "2026-10-10T00:00:00Z",
    effectiveNotificationLevel: "ALL",
  };
}

beforeEach(() => {
  useRelayStore.getState().reset();
  useRelayStore
    .getState()
    .setStarted(
      { serverId: "rims1_relay", roles: ["host", "relay"], directSpaceId: "direct-1" },
      { endpoint: "e", userId: "u1", principalId: "rimp1_me", deviceId: "d1" },
      [
        { account: "a", spaceId: "remote-space", hostServerId: "rims1_other", kind: "direct" },
        { account: "a", spaceId: "remote-ws", hostServerId: "rims1_other", kind: "workspace" },
      ],
    );
  useWorkspaceStore.setState({ workspaceId: "direct-1" });
  useShellStore.getState().setSelectedConversationId("local-dm");
  inbox.fetchInboxConversations.mockImplementation(async (spaceId: string) => ({
    items:
      spaceId === "direct-1" ? [dm("local-dm", "direct-1")] : [dm("remote-dm", "remote-space")],
    pageInfo: { hasNext: false, hasPrev: false },
  }));
  relayApi.fetchDmRequests.mockResolvedValue([]);
  relayApi.fetchConversationPredecessor.mockImplementation(async (_s: string, id: string) => ({
    id,
    memberIds: [],
    predecessor: null,
  }));
});

describe("DirectConversationList", () => {
  it("lists the DMs of this relay's direct space and those homed on other relays", async () => {
    renderWithProviders(<DirectConversationList />);
    expect(await screen.findByText("Carol")).toBeInTheDocument();
    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(inbox.fetchInboxConversations).toHaveBeenCalledWith("remote-space");
  });

  it("switches to the conversation's own space when it is opened", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DirectConversationList />);
    await user.click(await screen.findByText("Alice"));
    await waitFor(() => expect(useWorkspaceStore.getState().workspaceId).toBe("remote-space"));
    expect(useShellStore.getState().selectedConversationId).toBe("remote-dm");
  });

  it("opens its first DM under a main-area plugin panel, and closes the panel when one is clicked", async () => {
    useShellStore.getState().setSelectedConversationId(null);
    useShellStore.getState().openPluginPanel("chat.rim.k8s-pods", "pods", "main_area");
    const user = userEvent.setup();
    renderWithProviders(<DirectConversationList />);

    await waitFor(() => expect(useShellStore.getState().selectedConversationId).toBe("local-dm"));
    expect(useShellStore.getState().activePluginPanel).not.toBeNull();

    await user.click(await screen.findByText("Alice"));
    await waitFor(() => expect(useShellStore.getState().selectedConversationId).toBe("remote-dm"));
    expect(useShellStore.getState().activePluginPanel).toBeNull();
  });

  it("shows an open draft first and opens no conversation while it is open", async () => {
    const dan = { principalId: "rimp1_dan", relayUrls: [], name: "Dan" };
    useShellStore.getState().openDraftDirect({ spaceId: "direct-1", member: dan });
    renderWithProviders(<DirectConversationList />);

    const draftRow = (await screen.findByText("New message to Dan")).closest("li")!;
    expect(draftRow).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("option")[0]).toBe(draftRow);
    await screen.findByText("Carol");
    expect(useShellStore.getState().selectedConversationId).toBeNull();

    // Without the draft, the first conversation of the space opens.
    act(() => useShellStore.getState().setSelectedConversationId(null));
    await waitFor(() => expect(useShellStore.getState().selectedConversationId).toBe("local-dm"));
    expect(screen.queryByText("New message to Dan")).not.toBeInTheDocument();
  });

  it("heads the list with requests from outside every workspace, leaving a workspace's out", async () => {
    relayApi.fetchDmRequests.mockResolvedValue([
      makeDmRequest("r1", "rims1_relay", "direct-1"),
      makeDmRequest("r2", "rims1_other", "remote-space"),
      makeDmRequest("r3", "rims1_other", "remote-ws"),
    ]);
    const user = userEvent.setup();
    renderWithProviders(<DirectConversationList />);
    await user.click(await screen.findByRole("button", { name: "Requests (2)" }));
    expect(useShellStore.getState().mainSurface).toEqual({
      kind: "dm-requests",
      workspaceId: null,
    });
  });

  it("shows no requests row without pending requests", async () => {
    renderWithProviders(<DirectConversationList />);
    await screen.findByText("Carol");
    await waitFor(() => expect(relayApi.fetchDmRequests).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /^Requests/ })).not.toBeInTheDocument();
  });
});
