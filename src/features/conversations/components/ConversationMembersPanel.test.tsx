import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";

import { createTestQueryClient } from "../../../test/utils";
import { fakeServerInfo } from "../../../test/serverInfo";
import {
  ConversationTypeEnum,
  ServerMemberRoleGql,
} from "../../../core/graphql/generated/schema-types";
import { toast } from "../../../shared/toast";
import { queryKeys } from "../../../core/query/keys";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import type { ConversationSummary } from "../types";
import {
  baseReadHandlers,
  callsTo,
  currentUser,
  emptyInbox,
  graphqlError,
  makeConversation,
  routeRequests,
  workspaceMembers,
} from "../__fixtures__/conversations";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));
vi.mock("../../../shared/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));
const direct = vi.hoisted(() => ({ resolveDirectMembers: vi.fn() }));
const relayApi = vi.hoisted(() => ({ fetchContacts: vi.fn() }));
const identity = vi.hoisted(() => ({ fetchVerifiedIdentity: vi.fn() }));
vi.mock("../../relay/conversations/startDirect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../relay/conversations/startDirect")>()),
  ...direct,
}));
vi.mock("../../relay/api/relayApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../relay/api/relayApi")>()),
  ...relayApi,
}));
vi.mock("../../relay/contacts/identity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../relay/contacts/identity")>()),
  ...identity,
}));

import { useRelayStore } from "../../relay/state/useRelayStore";
import { useMembersPanelStore } from "../state/useMembersPanelStore";
import { ConversationMembersPanel } from "./ConversationMembersPanel";

const channel = makeConversation({ memberIds: ["me", "u-alice"], memberCount: 2 });
const encryptedGroup = makeConversation({
  title: "plans",
  conversationType: ConversationTypeEnum.GROUP,
  memberIds: ["me", "u-alice"],
  memberCount: 2,
  encryptedAt: "2026-10-15T00:00:00Z",
});

/** An encrypted group whose `addConversationMembers` answers with `add`. */
function serveEncryptedGroup(add: () => unknown) {
  routeRequests(requestMock, {
    ...baseReadHandlers,
    "query Server(": () => ({
      server: { id: "ws-1", name: "Acme", viewerRole: ServerMemberRoleGql.MEMBER },
    }),
    "query Conversation(": () => ({ conversation: encryptedGroup }),
    "mutation AddConversationMembers": add,
  });
}

/** The labels of the open menu's top-level items. */
function menuItems() {
  return within(screen.getByRole("menu"))
    .getAllByRole("menuitem")
    .map((el) => el.textContent ?? "");
}

async function inviteBob() {
  fireEvent.click(screen.getByRole("button", { name: /invite|add people/i }));
  fireEvent.click(await screen.findByRole("option", { name: /Bob/ }));
  fireEvent.click(screen.getByRole("button", { name: "Add (1)" }));
}

function serve(role: ServerMemberRoleGql, conversation: ConversationSummary = channel) {
  routeRequests(requestMock, {
    ...baseReadHandlers,
    "query Server(": () => ({ server: { id: "ws-1", name: "Acme", viewerRole: role } }),
    "query Conversation(": () => ({ conversation }),
    "mutation AddConversationMembers": () => ({
      addConversationMembers: { ...conversation, memberIds: [...conversation.memberIds, "u-bob"] },
    }),
    "mutation RemoveConversationMember": () => ({ removeConversationMember: true }),
    "mutation LeaveConversation": () => ({ leaveConversation: true }),
  });
}

async function renderPanel(role: ServerMemberRoleGql, seed?: (qc: QueryClient) => void) {
  const qc = createTestQueryClient();
  seed?.(qc);
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <ConversationMembersPanel workspaceId="ws-1" conversationId="conv-1" onClose={onClose} />
    </QueryClientProvider>,
  );
  await screen.findByTestId("member-row-u-alice");
  await waitFor(() =>
    expect(qc.getQueryData<{ viewerRole: string }>(queryKeys.server("ws-1"))?.viewerRole).toBe(
      role,
    ),
  );
  return { qc, onClose };
}

/** A server whose default workspace, which every account joins, is ws-1. */
function defaultWorkspaceIsWs1(qc: QueryClient) {
  qc.setQueryDefaults(queryKeys.serverInfo, { gcTime: Infinity });
  qc.setQueryData(queryKeys.serverInfo, fakeServerInfo({}, { defaultWorkspace: "ws-1" }));
}

const dave = { principalId: "rimp1_dave", relayUrls: ["https://relay-b.example"], name: "Dave" };

/**
 * A group of the direct space ws-1, where the viewer is a guest: Alice is in it, and the
 * viewer's contacts are Alice and Dave. `AddDirectConversationMembers` answers with Dave added.
 */
function serveDirectGroup(group: ConversationSummary) {
  useRelayStore.setState({
    info: { serverId: "relay", roles: [], directSpaceId: "ws-1" },
    account: { endpoint: "e", userId: "me", principalId: "rimp1_me", deviceId: "d1" },
  });
  const contacts = [{ principalId: "rimp1_alice", relayUrls: [], name: "Alice" }, dave];
  relayApi.fetchContacts.mockResolvedValue(
    contacts.map((c) => ({ principalId: c.principalId, relayUrls: c.relayUrls, addedAt: "" })),
  );
  identity.fetchVerifiedIdentity.mockImplementation((principalId: string) =>
    Promise.resolve({
      identity: {},
      card: {
        displayName: contacts.find((c) => c.principalId === principalId)?.name ?? "",
        relays: [],
        version: 1,
      },
    }),
  );
  routeRequests(requestMock, {
    "query Me": () => ({ me: currentUser }),
    "query ServerMembers": () => ({
      serverMembers: workspaceMembers.map((m) => ({
        ...m,
        memberRole: ServerMemberRoleGql.GUEST,
        principalId: `rimp1_${m.username}`,
      })),
    }),
    "query MyServers": () => ({ myServers: [] }),
    "query Server(": () => ({
      server: { id: "ws-1", name: "Direct", viewerRole: ServerMemberRoleGql.GUEST },
    }),
    "query Conversation(": () => ({ conversation: group }),
    "query InboxConversations": () => emptyInbox,
    "mutation AddDirectConversationMembers": () => ({
      addConversationMembers: { ...group, memberIds: [...group.memberIds, "u-dave"] },
    }),
  });
}

const directGroup = makeConversation({
  conversationType: ConversationTypeEnum.GROUP,
  title: "crew",
  memberIds: ["me", "u-alice"],
  memberCount: 2,
});

describe("ConversationMembersPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestMock.mockReset();
    useShellStore.getState().reset();
    useAuthStore.setState({ session: { userId: "me" } });
    useMembersPanelStore.setState({ open: false, invitingIn: null });
  });

  afterEach(() => {
    useAuthStore.setState({ session: null });
    useRelayStore.setState({ info: null, account: null });
  });

  it("offers Add people to a guest in a group of the direct space", async () => {
    serveDirectGroup(directGroup);
    await renderPanel(ServerMemberRoleGql.GUEST);
    expect(screen.getByRole("button", { name: "Add people" })).toBeInTheDocument();
  });

  it("adds a contact to a direct-space group by principal", async () => {
    serveDirectGroup(directGroup);
    direct.resolveDirectMembers.mockResolvedValue([
      { member: dave, relayUrls: dave.relayUrls, ready: true },
    ]);
    await renderPanel(ServerMemberRoleGql.GUEST);
    fireEvent.click(screen.getByRole("button", { name: "Add people" }));

    // Alice is offered no more: she is in the group already.
    const options = await screen.findAllByRole("option");
    await waitFor(() => expect(options.map((o) => o.textContent)).toEqual(["Dave"]));
    fireEvent.click(screen.getByRole("option", { name: "Dave" }));
    fireEvent.click(screen.getByRole("button", { name: "Add (1)" }));

    await waitFor(() =>
      expect(callsTo(requestMock, "mutation AddDirectConversationMembers")).toEqual([
        {
          serverId: "ws-1",
          conversationId: "conv-1",
          remoteMembers: [{ principalId: "rimp1_dave", relayUrls: ["https://relay-b.example"] }],
        },
      ]),
    );
    expect(direct.resolveDirectMembers).toHaveBeenCalledWith([dave]);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Member added"));
    expect(useMembersPanelStore.getState().invitingIn).toBeNull();
  });

  it("names who cannot receive encrypted messages and adds nobody", async () => {
    serveDirectGroup({ ...directGroup, encryptedAt: "2026-10-15T00:00:00Z" });
    direct.resolveDirectMembers.mockResolvedValue([
      { member: dave, relayUrls: dave.relayUrls, ready: false },
    ]);
    await renderPanel(ServerMemberRoleGql.GUEST);
    fireEvent.click(screen.getByRole("button", { name: "Add people" }));
    fireEvent.click(await screen.findByRole("option", { name: "Dave" }));
    fireEvent.click(screen.getByRole("button", { name: "Add (1)" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Dave cannot receive encrypted messages yet: they need a device set up for encryption.",
      ),
    );
    expect(callsTo(requestMock, "mutation AddDirectConversationMembers")).toHaveLength(0);
    expect(useMembersPanelStore.getState().invitingIn).toBe("conv-1");
  });

  it("offers no Invite to a member in a channel of the default workspace", async () => {
    serve(ServerMemberRoleGql.MEMBER);
    await renderPanel(ServerMemberRoleGql.MEMBER, defaultWorkspaceIsWs1);
    expect(screen.queryByRole("button", { name: "Invite" })).not.toBeInTheDocument();
  });

  it("offers Invite to the creator of a private channel there", async () => {
    serve(
      ServerMemberRoleGql.MEMBER,
      makeConversation({ memberIds: ["me", "u-alice"], isPrivate: true, createdBy: "me" }),
    );
    await renderPanel(ServerMemberRoleGql.MEMBER, defaultWorkspaceIsWs1);
    expect(screen.getByRole("button", { name: "Invite" })).toBeInTheDocument();
  });

  it("lists the members, the viewer first and marked", async () => {
    serve(ServerMemberRoleGql.GUEST);
    await renderPanel(ServerMemberRoleGql.GUEST);
    const rows = screen.getAllByTestId(/^member-row-/);
    expect(rows.map((r) => r.dataset.testid)).toEqual(["member-row-me", "member-row-u-alice"]);
    expect(within(rows[0]).getByText("(you)")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Alice")).toBeInTheDocument();
  });

  it("invites workspace members who are not in the conversation yet", async () => {
    serve(ServerMemberRoleGql.MEMBER);
    await renderPanel(ServerMemberRoleGql.MEMBER);
    fireEvent.click(screen.getByRole("button", { name: /invite/i }));

    // Only Bob is offered: the viewer and Alice are already members.
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([expect.stringContaining("Bob")]);

    fireEvent.click(options[0]);
    fireEvent.click(screen.getByRole("button", { name: "Add (1)" }));

    await waitFor(() =>
      expect(callsTo(requestMock, "mutation AddConversationMembers")).toEqual([
        { serverId: "ws-1", conversationId: "conv-1", userIds: ["u-bob"] },
      ]),
    );
  });

  it("opens with the invite picker when a conversation menu asked for it", async () => {
    serve(ServerMemberRoleGql.MEMBER);
    useMembersPanelStore.getState().openInvite("conv-1");
    await renderPanel(ServerMemberRoleGql.MEMBER);
    expect(screen.getByPlaceholderText("Find people to invite...")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useMembersPanelStore.getState().invitingIn).toBeNull();
    expect(screen.getByRole("button", { name: /invite/i })).toBeInTheDocument();
  });

  it("keeps Escape in the invite picker to the picker", async () => {
    serve(ServerMemberRoleGql.MEMBER);
    useMembersPanelStore.getState().openInvite("conv-1");
    await renderPanel(ServerMemberRoleGql.MEMBER);
    const input = screen.getByPlaceholderText("Find people to invite...");
    expect(input.closest("[data-owns-escape]")).not.toBeNull();

    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByPlaceholderText("Find people to invite...")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Members/ })).toBeInTheDocument();
    expect(useMembersPanelStore.getState().open).toBe(true);
  });

  it("puts a row's actions beside the name, not after it", async () => {
    serve(ServerMemberRoleGql.MODERATOR);
    await renderPanel(ServerMemberRoleGql.MODERATOR);
    const row = screen.getByTestId("member-row-me");
    const actions = row.querySelector("[data-row-actions]") as HTMLElement;

    expect(actions).not.toBeNull();
    expect(within(actions).getByRole("button", { name: "Leave" })).toBeInTheDocument();
    expect(within(actions).getByRole("button", { name: /^Actions for / })).toBeInTheDocument();
    expect(screen.getByText("(you)").closest("[data-row-actions]")).toBeNull();
  });

  it("lists invited members after the members, marked as invited and not counted", async () => {
    serve(ServerMemberRoleGql.MEMBER, { ...encryptedGroup, pendingMemberIds: ["u-bob"] });
    await renderPanel(ServerMemberRoleGql.MEMBER);
    const rows = screen.getAllByTestId(/^member-row-/);
    expect(rows.map((r) => r.dataset.testid)).toEqual([
      "member-row-me",
      "member-row-u-alice",
      "member-row-u-bob",
    ]);
    expect(within(rows[2]).getByText("Invited")).toBeInTheDocument();
    expect(
      within(rows[2]).getByText("Waiting for a device set up for encryption"),
    ).toBeInTheDocument();
    expect(within(rows[1]).queryByText("Invited")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Members/ })).toHaveTextContent(
      "plans · 2 · 1 invited",
    );
  });

  it("says when someone added to an encrypted group joins once they have a device", async () => {
    serveEncryptedGroup(() => ({
      addConversationMembers: { ...encryptedGroup, pendingMemberIds: ["u-bob"] },
    }));
    await renderPanel(ServerMemberRoleGql.MEMBER);
    await inviteBob();
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Member added", {
        description: "Bob joins once they set up a device for encryption.",
      }),
    );
  });

  it("shows the server's message when the invitation cap refuses an addition", async () => {
    const refusal = "this instance allows 50 pending invitations per user";
    serveEncryptedGroup(() => {
      throw graphqlError("VALIDATION", refusal);
    });
    await renderPanel(ServerMemberRoleGql.MEMBER);
    await inviteBob();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(refusal));
  });

  it("offers no Invite to a guest", async () => {
    serve(ServerMemberRoleGql.GUEST);
    await renderPanel(ServerMemberRoleGql.GUEST);
    expect(screen.queryByRole("button", { name: /invite/i })).not.toBeInTheDocument();
  });

  it("does not offer Remove to a guest", async () => {
    serve(ServerMemberRoleGql.GUEST);
    await renderPanel(ServerMemberRoleGql.GUEST);
    expect(screen.queryByRole("button", { name: "Remove Alice" })).not.toBeInTheDocument();
  });

  it("lets a moderator remove another member after confirming", async () => {
    serve(ServerMemberRoleGql.MODERATOR);
    await renderPanel(ServerMemberRoleGql.MODERATOR);
    fireEvent.click(screen.getByRole("button", { name: "Remove Alice" }));
    expect(callsTo(requestMock, "mutation RemoveConversationMember")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Confirm removing Alice" }));

    await waitFor(() =>
      expect(callsTo(requestMock, "mutation RemoveConversationMember")).toEqual([
        { serverId: "ws-1", conversationId: "conv-1", userId: "u-alice" },
      ]),
    );
    // Never on the viewer's own row: that one is Leave.
    expect(screen.queryByRole("button", { name: /remove me myself/i })).not.toBeInTheDocument();
  });

  it("the viewer's own row leaves the conversation", async () => {
    serve(ServerMemberRoleGql.MODERATOR);
    useShellStore.setState({ selectedConversationId: "conv-1" });
    await renderPanel(ServerMemberRoleGql.MODERATOR);
    fireEvent.click(
      within(screen.getByTestId("member-row-me")).getByRole("button", { name: "Leave" }),
    );

    await waitFor(() =>
      expect(callsTo(requestMock, "mutation LeaveConversation")).toEqual([
        { serverId: "ws-1", conversationId: "conv-1" },
      ]),
    );
    await waitFor(() => expect(useShellStore.getState().selectedConversationId).toBeNull());
  });

  it("offers no Invite to a viewer who has not joined the public channel", async () => {
    serve(ServerMemberRoleGql.GUEST, makeConversation({ memberIds: ["u-alice"], isMember: false }));
    await renderPanel(ServerMemberRoleGql.GUEST);
    expect(screen.queryByRole("button", { name: /invite/i })).not.toBeInTheDocument();
  });

  it("shows role badges and a timeout marker, and the moderation menu to a moderator", async () => {
    routeRequests(requestMock, {
      "query Me": () => ({ me: currentUser }),
      "query ServerMembers": () => ({
        serverMembers: workspaceMembers.map((m) =>
          m.userId === "u-alice"
            ? { ...m, memberRole: ServerMemberRoleGql.GUEST, timeoutUntil: "2999-01-01T00:00:00Z" }
            : m.userId === "me"
              ? { ...m, memberRole: ServerMemberRoleGql.MODERATOR }
              : m,
        ),
      }),
      "query Server(": () => ({
        server: { id: "ws-1", name: "Acme", viewerRole: ServerMemberRoleGql.MODERATOR },
      }),
      "query Conversation(": () => ({ conversation: channel }),
      "query InboxConversations": () => emptyInbox,
    });
    await renderPanel(ServerMemberRoleGql.MODERATOR);

    const alice = screen.getByTestId("member-row-u-alice");
    await waitFor(() => expect(within(alice).getByTestId("role-badge")).toHaveTextContent("Guest"));
    expect(within(alice).getByTestId("timeout-marker")).toHaveTextContent("Timed out until");
    fireEvent.click(within(alice).getByRole("button", { name: "Actions for Alice" }));
    expect(screen.getByText("Moderation")).toBeInTheDocument();
    expect(menuItems()).toContain("Clear timeout");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    const me = screen.getByTestId("member-row-me");
    expect(within(me).getByTestId("role-badge")).toHaveTextContent("Moderator");
    fireEvent.contextMenu(me);
    expect(screen.queryByText("Moderation")).not.toBeInTheDocument();
  });

  it("shows no role badges in the direct space, where everyone is a guest", async () => {
    useRelayStore.setState({
      info: { serverId: "relay", roles: [], directSpaceId: "ws-1" },
    });
    const group = makeConversation({
      conversationType: ConversationTypeEnum.GROUP,
      memberIds: ["me", "u-alice"],
      memberCount: 2,
    });
    routeRequests(requestMock, {
      "query Me": () => ({ me: currentUser }),
      "query ServerMembers": () => ({
        serverMembers: workspaceMembers.map((m) => ({
          ...m,
          memberRole: ServerMemberRoleGql.GUEST,
        })),
      }),
      "query Server(": () => ({
        server: { id: "ws-1", name: "Direct", viewerRole: ServerMemberRoleGql.GUEST },
      }),
      "query Conversation(": () => ({ conversation: group }),
      "query InboxConversations": () => emptyInbox,
    });
    await renderPanel(ServerMemberRoleGql.GUEST);

    expect(screen.getByTestId("member-row-u-alice")).toBeInTheDocument();
    expect(screen.queryByTestId("role-badge")).toBeNull();
  });

  it("gives ordinary members no badge, no moderation and no removal", async () => {
    serve(ServerMemberRoleGql.MEMBER);
    await renderPanel(ServerMemberRoleGql.MEMBER);
    expect(screen.queryByTestId("role-badge")).not.toBeInTheDocument();
    fireEvent.contextMenu(screen.getByTestId("member-row-u-alice"));
    expect(menuItems()).toEqual(["View profile", "Send message", "Copy @username"]);
  });

  it("opens the same person menu from a right click on a row and from its button", async () => {
    serve(ServerMemberRoleGql.MODERATOR);
    const { qc } = await renderPanel(ServerMemberRoleGql.MODERATOR);
    await waitFor(() => expect(qc.getQueryData(queryKeys.serverMembers("ws-1"))).toBeDefined());
    const alice = screen.getByTestId("member-row-u-alice");
    fireEvent.contextMenu(alice);
    const fromRow = menuItems();
    expect(fromRow).toEqual([
      "View profile",
      "Send message",
      "Copy @username",
      "Remove from #general…",
      "Change role",
      "Time out",
      "Kick…",
      "Ban…",
    ]);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    fireEvent.click(within(alice).getByRole("button", { name: "Actions for Alice" }));
    expect(menuItems()).toEqual(fromRow);
  });

  it("removes a member from the menu after the row's confirmation", async () => {
    serve(ServerMemberRoleGql.MODERATOR);
    await renderPanel(ServerMemberRoleGql.MODERATOR);
    fireEvent.keyDown(screen.getByRole("button", { name: "Remove Alice" }), {
      key: "ContextMenu",
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove from #general…" }));
    expect(callsTo(requestMock, "mutation RemoveConversationMember")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Confirm removing Alice" }));
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation RemoveConversationMember")).toEqual([
        { serverId: "ws-1", conversationId: "conv-1", userId: "u-alice" },
      ]),
    );
  });
});
