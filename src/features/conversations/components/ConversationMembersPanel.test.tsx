import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { createTestQueryClient } from "../../../test/utils";
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
  fireEvent.click(screen.getByRole("button", { name: /invite/i }));
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

async function renderPanel(role: ServerMemberRoleGql) {
  const qc = createTestQueryClient();
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

describe("ConversationMembersPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestMock.mockReset();
    useShellStore.getState().reset();
    useAuthStore.setState({ session: { userId: "me" } });
  });

  afterEach(() => {
    useAuthStore.setState({ session: null });
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
