import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";

import { createTestQueryClient } from "../../../test/utils";
import { fakeServerInfo } from "../../../test/serverInfo";
import {
  ConversationTypeEnum,
  ServerMemberRoleGql,
} from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useRelayStore } from "../../relay/state/useRelayStore";
import { useE2eeStore } from "../../e2ee/state/useE2eeStore";
import { useQuickAccessStore } from "../../commands/state/useQuickAccessStore";
import { useMembersPanelStore } from "../state/useMembersPanelStore";
import { useUnreadStore } from "../state/useUnreadStore";
import {
  baseReadHandlers,
  callsTo,
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
vi.mock("../../commands/hooks/useKeybindLabel", () => ({ useKeybindLabel: () => null }));
vi.mock("../../../core/events/usePrefetchMessages", () => ({ usePrefetchMessages: vi.fn() }));

import { ConversationList } from "./ConversationList";

const general = makeConversation({ id: "c-general", title: "general" });
const random = makeConversation({ id: "c-random", title: "random" });
const oldNews = makeConversation({ id: "c-old", title: "old-news", isArchived: true });
const dm = makeConversation({
  id: "c-dm",
  title: null,
  conversationType: ConversationTypeEnum.DIRECT,
  memberIds: ["me", "u-alice"],
});
const invitation = makeConversation({
  id: "c-invite",
  title: "secret plans",
  conversationType: ConversationTypeEnum.GROUP,
  memberIds: ["u-alice"],
  pendingMemberIds: ["me"],
});

function page(items: unknown[]) {
  return { channels: { items, pageInfo: { hasNext: false, hasPrev: false } } };
}

function serve({
  role = ServerMemberRoleGql.MEMBER,
  inbox = [dm] as unknown[],
  extra = {} as Record<string, (vars: Record<string, unknown>) => unknown>,
} = {}) {
  routeRequests(requestMock, {
    ...baseReadHandlers,
    "query ServerMembers": () => ({
      serverMembers: workspaceMembers.map((m) => ({ ...m, principalId: `rimp1_${m.username}` })),
    }),
    "query Server(": () => ({ server: { id: "ws-1", name: "Acme", viewerRole: role } }),
    "query Channels": () => page([general, random, oldNews]),
    "query InboxConversations": () => ({
      inboxConversations: { items: inbox, pageInfo: { hasNext: false, hasPrev: false } },
    }),
    ...extra,
  });
}

async function renderList(role = ServerMemberRoleGql.MEMBER, defaultWorkspace?: string) {
  const onNewChannel = vi.fn();
  const qc = createTestQueryClient();
  if (defaultWorkspace) {
    qc.setQueryData(queryKeys.serverInfo, fakeServerInfo({}, { defaultWorkspace }));
  }
  render(
    <QueryClientProvider client={qc}>
      <ConversationList onNewChannel={onNewChannel} />
    </QueryClientProvider>,
  );
  await screen.findByText("general");
  await waitFor(() =>
    expect(qc.getQueryData<{ viewerRole: string }>(queryKeys.server("ws-1"))?.viewerRole).toBe(
      role,
    ),
  );
  return { qc, onNewChannel };
}

function rowButton(name: string): HTMLElement {
  return screen.getByText(name).closest("button")!;
}

/** The open menu's items by accessible name. */
function menuLabels(): string[] {
  return within(screen.getByRole("menu"))
    .getAllByRole("menuitem")
    .map((el) => el.getAttribute("aria-label") ?? el.firstElementChild?.textContent ?? "");
}

describe("ConversationList — conversation context menus", () => {
  beforeEach(() => {
    requestMock.mockReset();
    useShellStore.getState().reset();
    useShellStore.setState({ selectedConversationId: "c-general" });
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useAuthStore.setState({ session: { userId: "me" } });
    useMembersPanelStore.setState({ open: false, invitingIn: null });
    useQuickAccessStore.getState().close();
    useUnreadStore.setState({ counts: {}, spaceOf: {} });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
    useAuthStore.setState({ session: null });
    useRelayStore.getState().reset();
    useE2eeStore.setState({ webEncryption: "checking" });
  });

  it("opens a channel's menu on right click, with the same items as its header", async () => {
    serve();
    await renderList();
    fireEvent.contextMenu(rowButton("random"));
    expect(screen.getByRole("menu", { name: "Conversation actions" })).toBeInTheDocument();
    expect(menuLabels()).toEqual([
      "Notifications: All messages",
      "Members",
      "Invite people…",
      "Assign keybind…",
      "Leave channel",
    ]);
  });

  it("adds Mark as read for an unread channel and the moderation section for a moderator", async () => {
    serve({ role: ServerMemberRoleGql.MODERATOR });
    useUnreadStore.getState().setCounts("ws-1", { "c-random": 2 });
    await renderList(ServerMemberRoleGql.MODERATOR);
    fireEvent.contextMenu(rowButton("random"));
    expect(menuLabels()).toEqual([
      "Mark as read",
      "Notifications: All messages",
      "Members",
      "Invite people…",
      "Edit topic…",
      "Assign keybind…",
      "Slow mode…",
      "Who can post…",
      "Archive channel…",
      "Leave channel",
    ]);
  });

  it("opens the menu of a Tab-focused row with the ContextMenu key", async () => {
    serve();
    await renderList();
    const row = rowButton("random");
    row.focus();
    fireEvent.keyDown(row, { key: "ContextMenu" });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(menuLabels()).toContain("Leave channel");
  });

  it("opens the highlighted row's menu with Shift+F10 on the list", async () => {
    serve();
    const user = userEvent.setup();
    await renderList();
    screen.getByRole("listbox").focus();
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Shift>}{F10}{/Shift}");
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Assign keybind…" }));
    expect(useQuickAccessStore.getState().target).toMatchObject({
      kind: "channel",
      conversationId: "c-random",
    });
    // Choosing an item did not open the highlighted conversation.
    expect(useShellStore.getState().selectedConversationId).toBe("c-general");
  });

  it("Members opens the row's conversation with its members panel", async () => {
    serve();
    await renderList();
    fireEvent.contextMenu(rowButton("random"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Members" }));
    expect(useShellStore.getState().selectedConversationId).toBe("c-random");
    expect(useMembersPanelStore.getState().open).toBe(true);
  });

  it("Leave on a row leaves that channel", async () => {
    serve({ extra: { "mutation LeaveConversation": () => ({ leaveConversation: true }) } });
    await renderList();
    fireEvent.contextMenu(rowButton("random"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Leave channel" }));
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation LeaveConversation")).toEqual([
        { serverId: "ws-1", conversationId: "c-random" },
      ]),
    );
  });

  it("a DM has no Members, Leave or moderation, even for an owner", async () => {
    serve({ role: ServerMemberRoleGql.OWNER });
    await renderList(ServerMemberRoleGql.OWNER);
    fireEvent.contextMenu(rowButton("Alice"));
    expect(menuLabels()).toEqual(["Notifications: All messages", "Assign keybind…"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Assign keybind…" }));
    expect(useQuickAccessStore.getState().target).toEqual({
      kind: "dm",
      conversationId: "c-dm",
      serverId: "ws-1",
      label: "Alice",
    });
  });

  it("offers a DM's person as a contact while the relay is on, and removes one", async () => {
    useRelayStore
      .getState()
      .setStarted(
        { serverId: "rims1_relay", roles: ["host", "relay"], directSpaceId: "direct-1" },
        { endpoint: "e", userId: "me", principalId: "rimp1_me", deviceId: "d1" },
        [],
      );
    let contacts = [{ principalId: "rimp1_alice", relayUrls: ["https://r"] }];
    serve({
      extra: {
        "query Contacts": () => ({ contacts }),
        "mutation RemoveContact": () => {
          contacts = [];
          return { removeContact: true };
        },
      },
    });
    const { qc } = await renderList();
    await waitFor(() => expect(qc.getQueryData(queryKeys.relayContacts)).toBeDefined());
    fireEvent.contextMenu(rowButton("Alice"));
    expect(menuLabels()).toEqual([
      "Notifications: All messages",
      "Remove from contacts",
      "Assign keybind…",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove from contacts" }));
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation RemoveContact")).toEqual([
        { principalId: "rimp1_alice" },
      ]),
    );
    await waitFor(() => expect(qc.getQueryData(queryKeys.relayContacts)).toEqual([]));
    fireEvent.contextMenu(rowButton("Alice"));
    expect(menuLabels()).toContain("Add to contacts");
  });

  it("an invitation offers Decline, and Accept on a device set up for encryption", async () => {
    serve({
      inbox: [invitation],
      extra: {
        "mutation DeclineConversationInvite": () => ({ declineConversationInvite: true }),
      },
    });
    await renderList();
    fireEvent.contextMenu(rowButton("secret plans"));
    expect(menuLabels()).toEqual(["Decline"]);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    act(() => useE2eeStore.setState({ webEncryption: "ready" }));
    fireEvent.contextMenu(rowButton("secret plans"));
    expect(menuLabels()).toEqual(["Accept", "Decline"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Decline" }));
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation DeclineConversationInvite")).toEqual([
        { serverId: "ws-1", conversationId: "c-invite" },
      ]),
    );
  });
});

describe("ConversationList — section header menus", () => {
  beforeEach(() => {
    requestMock.mockReset();
    useShellStore.getState().reset();
    useShellStore.setState({ selectedConversationId: "c-general" });
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useAuthStore.setState({ session: { userId: "me" } });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
    useAuthStore.setState({ session: null });
  });

  it("Channels offers Browse channels and Create channel", async () => {
    serve();
    const { onNewChannel } = await renderList();
    fireEvent.contextMenu(screen.getByText("Channels"));
    expect(menuLabels()).toEqual(["Browse channels…", "Create channel…"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Create channel…" }));
    expect(onNewChannel).toHaveBeenCalledTimes(1);
    fireEvent.contextMenu(screen.getByText("Channels"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Browse channels…" }));
    expect(await screen.findByRole("dialog", { name: "Browse channels" })).toBeInTheDocument();
  });

  it("Channels offers a member of the default workspace Browse channels only", async () => {
    serve();
    await renderList(ServerMemberRoleGql.MEMBER, "ws-1");
    fireEvent.contextMenu(screen.getByText("Channels"));
    expect(menuLabels()).toEqual(["Browse channels…"]);
  });

  it("Channels opens nothing for a guest and leaves the browser's menu alone", async () => {
    serve({ role: ServerMemberRoleGql.GUEST });
    await renderList(ServerMemberRoleGql.GUEST);
    expect(fireEvent.contextMenu(screen.getByText("Channels"))).toBe(true);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("Archived expands and collapses its section", async () => {
    serve();
    await renderList();
    const header = screen.getByRole("button", { name: /archived \(1\)/i });
    fireEvent.contextMenu(header);
    fireEvent.click(screen.getByRole("menuitem", { name: "Expand section" }));
    expect(header).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(header, { key: "ContextMenu" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Collapse section" }));
    expect(header).toHaveAttribute("aria-expanded", "false");
  });
});
