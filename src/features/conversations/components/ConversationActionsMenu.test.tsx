import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";

import { createTestQueryClient } from "../../../test/utils";
import { fakeServerInfo } from "../../../test/serverInfo";
import type { KnownServerInfo } from "../../updater/api/serverInfoApi";
import {
  ConversationTypeEnum,
  PostingPolicy,
  ServerMemberRoleGql,
} from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { useShellStore } from "../../../shell/state/useShellStore";
import { toast } from "../../../shared/toast";
import type { ConversationSummary } from "../types";
import {
  callsTo,
  graphqlError,
  makeConversation,
  routeRequests,
  workspaceMembers,
} from "../__fixtures__/conversations";
import { useMembersPanelStore } from "../state/useMembersPanelStore";
import { useAgentEncryptedStore } from "../../agent/state/useAgentEncryptedStore";
import { resetAskAgent, useAskAgentStore } from "../../agents/state/useAskAgentStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { queryClient } from "../../../core/query/queryClient";
import { useBlockPersonStore } from "../../relay/blocking/useBlockPersonStore";
import { useRelayStore } from "../../relay/state/useRelayStore";
import { useQuickAccessStore } from "../../commands/state/useQuickAccessStore";
import { useTopicEditStore } from "../state/useTopicEditStore";
import { useUnreadStore } from "../state/useUnreadStore";
import { INCOMING_WEBHOOKS } from "../../updater/api/serverCapabilities";
import { ServerFeatureState } from "../../../core/graphql/generated/schema-types";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));
const platform = vi.hoisted(() => ({ current: "web" }));
vi.mock("../../../core/runtime/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../core/runtime/runtime")>()),
  detectPlatform: () => platform.current,
}));
vi.mock("../../../shared/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));

vi.mock("../../bots/webhookUrl", () => ({
  webhookUrl: async (token: string) => `https://rim.example/api/hooks/${token}`,
}));

import { ConversationActionsMenu } from "./ConversationActionsMenu";
import { ConversationActionConfirmHost } from "./ConversationActionConfirmHost";
import { ManageCommandHost } from "../../commands/components/ManageCommandHost";
import { channelPostingKey } from "../api/useChannelPosting";
import {
  clearServedCommands,
  commandSucceeded,
  sentCommands,
  serveCommands,
} from "../../../test/clickCommands";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";

/** The server commands the menu and its dialogs run, which the workspace's server lists. */
const MENU_COMMANDS = [
  "chat.join_channel",
  "chat.mark_as_read",
  "chat.archive_channel",
  "chat.unarchive_channel",
  "chat.leave_conversation",
  "chat.set_slow_mode",
  "chat.set_channel_posting",
  "notifications.set_level",
  "notifications.mute_conversation",
  "notifications.unmute_conversation",
];

function serve(role: ServerMemberRoleGql, overrides: Record<string, () => unknown> = {}) {
  routeRequests(requestMock, {
    "query Server(": () => ({ server: { id: "ws-1", name: "Acme", viewerRole: role } }),
    "mutation ExecuteCommand": () => commandSucceeded(),
    ...overrides,
  });
}

/** What a menu item on `conv-1` of `ws-1` sends, as the palette would apart from the initiator. */
function menuRun(commandId: string, args: Record<string, unknown>) {
  return {
    commandId,
    args: { server_id: "ws-1", conversation_id: "conv-1", ...args },
    commandContext: { workspaceId: "ws-1", conversationId: "conv-1" },
    initiator: "CONTEXT_MENU",
  };
}

/** What a dialog's button on `conv-1` of `ws-1` sends, which names no initiator here. */
function dialogRun(commandId: string, args: Record<string, unknown>) {
  return {
    commandId,
    args: { server_id: "ws-1", conversation_id: "conv-1", ...args },
    commandContext: { workspaceId: "ws-1", conversationId: "conv-1" },
  };
}

beforeEach(() => {
  serveCommands("ws-1", MENU_COMMANDS);
  useWorkspaceStore.getState().setWorkspaceId("ws-1");
});

afterEach(() => {
  clearServedCommands();
  queryClient.clear();
  useWorkspaceStore.getState().clearWorkspaceId();
});

async function openMenu(
  conversation: ConversationSummary,
  role: ServerMemberRoleGql,
  seed?: (qc: QueryClient) => Promise<void>,
  serverInfo?: KnownServerInfo,
) {
  const qc = createTestQueryClient();
  if (serverInfo) {
    qc.setQueryDefaults(queryKeys.serverInfo, { gcTime: Infinity });
    qc.setQueryData(queryKeys.serverInfo, serverInfo);
    queryClient.setQueryData(queryKeys.serverInfo, serverInfo);
  }
  // The commands read the conversation and the viewer's role from the app's cache.
  queryClient.setQueryData(queryKeys.server("ws-1"), {
    id: "ws-1",
    name: "Acme",
    viewerRole: role,
  });
  queryClient.setQueryData(queryKeys.conversations("ws-1"), { items: [conversation] });
  render(
    <QueryClientProvider client={qc}>
      <ConversationActionsMenu workspaceId="ws-1" conversation={conversation} />
      <ConversationActionConfirmHost />
      <ManageCommandHost />
    </QueryClientProvider>,
  );
  // Let the role load before reading the menu.
  await waitFor(() =>
    expect(qc.getQueryData<{ viewerRole: string }>(queryKeys.server("ws-1"))?.viewerRole).toBe(
      role,
    ),
  );
  await seed?.(qc);
  fireEvent.click(screen.getByRole("button", { name: "Conversation menu" }));
  return qc;
}

/** The top level's items by accessible name, which joins a label and its detail. */
function menuLabels(): string[] {
  return screen
    .getAllByRole("menuitem")
    .map((el) => el.getAttribute("aria-label") ?? el.firstElementChild?.textContent ?? "");
}

describe("ConversationActionsMenu — role gating", () => {
  beforeEach(() => {
    requestMock.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    useShellStore.getState().reset();
    useMembersPanelStore.setState({ open: false, invitingIn: null });
    useTopicEditStore.getState().stop();
    useQuickAccessStore.getState().close();
    useUnreadStore.setState({ counts: {}, spaceOf: {} });
    useAuthStore.setState({ session: { userId: "me" } });
  });

  afterEach(() => {
    useShellStore.getState().reset();
    useAuthStore.setState({ session: null });
    useRelayStore.setState({ info: null });
  });

  it("a guest member of a channel gets no invite and no moderation", async () => {
    serve(ServerMemberRoleGql.GUEST);
    await openMenu(makeConversation(), ServerMemberRoleGql.GUEST);
    expect(menuLabels()).toEqual([
      "Notifications: All messages",
      "Members",
      "Assign keybind…",
      "Leave channel",
    ]);
  });

  it("a member of a channel can invite people", async () => {
    serve(ServerMemberRoleGql.MEMBER);
    await openMenu(makeConversation(), ServerMemberRoleGql.MEMBER);
    expect(menuLabels()).toEqual([
      "Notifications: All messages",
      "Members",
      "Invite people…",
      "Assign keybind…",
      "Leave channel",
    ]);
  });

  it("offers no Edit topic to a member of a public channel", async () => {
    serve(ServerMemberRoleGql.MEMBER);
    await openMenu(makeConversation({ createdBy: "me" }), ServerMemberRoleGql.MEMBER);
    expect(menuLabels()).not.toContain("Edit topic…");
  });

  it("offers Edit topic to the creator of a private channel", async () => {
    serve(ServerMemberRoleGql.MEMBER);
    await openMenu(
      makeConversation({ isPrivate: true, createdBy: "me" }),
      ServerMemberRoleGql.MEMBER,
    );
    expect(menuLabels()).toContain("Edit topic…");
  });

  it.each([ServerMemberRoleGql.OWNER, ServerMemberRoleGql.MODERATOR])(
    "%s gets Archive channel",
    async (role) => {
      serve(role);
      await openMenu(makeConversation(), role);
      expect(menuLabels()).toEqual([
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
      expect(screen.getByText("Moderation")).toBeInTheDocument();
    },
  );

  it("an archived channel offers only Members, a moderator's Unarchive, and Leave", async () => {
    serve(ServerMemberRoleGql.MODERATOR);
    await openMenu(makeConversation({ isArchived: true }), ServerMemberRoleGql.MODERATOR);
    expect(menuLabels()).toEqual(["Members", "Unarchive channel", "Leave channel"]);
  });

  it("an archived channel offers no Unarchive to a member", async () => {
    serve(ServerMemberRoleGql.MEMBER);
    await openMenu(makeConversation({ isArchived: true }), ServerMemberRoleGql.MEMBER);
    expect(menuLabels()).toEqual(["Members", "Leave channel"]);
  });

  it("puts Join channel first for a public channel the viewer has not joined", async () => {
    serve(ServerMemberRoleGql.MEMBER);
    useShellStore.setState({ selectedConversationId: "conv-other" });
    await openMenu(makeConversation({ isMember: false }), ServerMemberRoleGql.MEMBER);
    expect(menuLabels()).toEqual(["Join channel", "Members", "Assign keybind…"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Join channel" }));
    // The menu's own conversation, not the open one.
    await waitFor(() =>
      expect(sentCommands(requestMock)).toEqual([menuRun("chat.join_channel", {})]),
    );
  });

  it("offers a guest no Join channel", async () => {
    serve(ServerMemberRoleGql.GUEST);
    await openMenu(makeConversation({ isMember: false }), ServerMemberRoleGql.GUEST);
    expect(menuLabels()).not.toContain("Join channel");
  });

  it("offers no Leave or Archive for a DM, even to an owner", async () => {
    serve(ServerMemberRoleGql.OWNER);
    await openMenu(
      makeConversation({ conversationType: ConversationTypeEnum.DIRECT, title: null }),
      ServerMemberRoleGql.OWNER,
    );
    expect(menuLabels()).toEqual(["Notifications: All messages", "Members", "Assign keybind…"]);
  });

  describe("Block…", () => {
    const withPrincipals = workspaceMembers.map((m) => ({
      ...m,
      principalId: `rimp1_${m.username}`,
    }));

    async function openWithRelay(conversation: ConversationSummary) {
      useRelayStore
        .getState()
        .setStarted(
          { serverId: "rims1_relay", roles: ["host", "relay"], directSpaceId: "direct-1" },
          { endpoint: "e", userId: "me", principalId: "rimp1_me", deviceId: "d1" },
          [],
        );
      useBlockPersonStore.getState().close();
      serve(ServerMemberRoleGql.MEMBER);
      await openMenu(conversation, ServerMemberRoleGql.MEMBER, async (qc) => {
        qc.setQueryData(queryKeys.relayContacts, []);
        for (const client of [qc, queryClient]) {
          client.setQueryData(queryKeys.serverMembers("ws-1"), withPrincipals);
        }
      });
    }

    it("offers Block… last on a DM and asks before blocking its other person", async () => {
      await openWithRelay(
        makeConversation({
          conversationType: ConversationTypeEnum.DIRECT,
          title: null,
          memberIds: ["me", "u-alice"],
        }),
      );
      const labels = menuLabels();
      expect(labels[labels.length - 1]).toBe("Block…");
      fireEvent.click(screen.getByRole("menuitem", { name: "Block…" }));
      await waitFor(() =>
        expect(useBlockPersonStore.getState().target).toEqual({
          principalId: "rimp1_alice",
          name: "Alice",
        }),
      );
    });

    it("offers no Block… on a group", async () => {
      await openWithRelay(
        makeConversation({
          conversationType: ConversationTypeEnum.GROUP,
          title: "Team",
          memberIds: ["me", "u-alice", "u-bob"],
        }),
      );
      expect(menuLabels()).not.toContain("Block…");
    });
  });

  it("offers Add people and a confirmed Leave group for a group", async () => {
    serve(ServerMemberRoleGql.MEMBER);
    await openMenu(
      makeConversation({ conversationType: ConversationTypeEnum.GROUP, title: "crew" }),
      ServerMemberRoleGql.MEMBER,
    );
    expect(menuLabels()).toEqual([
      "Notifications: All messages",
      "Members",
      "Add people…",
      "Assign keybind…",
      "Leave group…",
    ]);
  });

  it("offers Add people for a group in the direct space", async () => {
    useRelayStore.setState({ info: { serverId: "relay", roles: [], directSpaceId: "ws-1" } });
    serve(ServerMemberRoleGql.GUEST);
    await openMenu(
      makeConversation({ conversationType: ConversationTypeEnum.GROUP, title: "crew" }),
      ServerMemberRoleGql.GUEST,
    );
    expect(menuLabels()).toEqual([
      "Notifications: All messages",
      "Members",
      "Add people…",
      "Assign keybind…",
      "Leave group…",
    ]);
  });

  it("offers no Invite people to a member in a default-workspace channel", async () => {
    serve(ServerMemberRoleGql.MEMBER);
    await openMenu(
      makeConversation(),
      ServerMemberRoleGql.MEMBER,
      undefined,
      fakeServerInfo({}, { defaultWorkspace: "ws-1" }),
    );
    expect(menuLabels()).toEqual([
      "Notifications: All messages",
      "Members",
      "Assign keybind…",
      "Leave channel",
    ]);
  });

  describe("Mark as unread", () => {
    const seedPages = (items: { id: string; authorId: string }[]) => async (qc: QueryClient) => {
      for (const client of [qc, queryClient]) {
        client.setQueryDefaults(queryKeys.messages("ws-1", "conv-1"), { gcTime: Infinity });
        client.setQueryData(queryKeys.messages("ws-1", "conv-1"), {
          pages: [{ items }],
          pageParams: [],
        });
      }
    };

    beforeEach(() => {
      useUnreadStore.setState({ countSources: { "ws-1": "markers" }, held: {} });
    });

    it("marks from the newest loaded message by someone else, and holds the open one", async () => {
      serve(ServerMemberRoleGql.MEMBER, {
        "mutation MarkAsUnread": () => ({ markAsUnread: true }),
      });
      useShellStore.setState({ selectedConversationId: "conv-1" });
      await openMenu(
        makeConversation(),
        ServerMemberRoleGql.MEMBER,
        seedPages([
          { id: "m-1", authorId: "bob" },
          { id: "m-2", authorId: "me" },
        ]),
      );
      fireEvent.click(screen.getByRole("menuitem", { name: "Mark as unread" }));
      await waitFor(() =>
        expect(callsTo(requestMock, "mutation MarkAsUnread")).toEqual([
          { input: { workspaceId: "ws-1", conversationId: "conv-1", messageId: "m-1" } },
        ]),
      );
      expect(useUnreadStore.getState().held).toEqual({ "conv-1": true });
    });

    it("is left out when what is loaded holds nothing by someone else", async () => {
      serve(ServerMemberRoleGql.MEMBER);
      await openMenu(
        makeConversation(),
        ServerMemberRoleGql.MEMBER,
        seedPages([{ id: "m-2", authorId: "me" }]),
      );
      expect(menuLabels()).not.toContain("Mark as unread");
    });

    it("with nothing loaded, says so if the first page has no one else's message", async () => {
      serve(ServerMemberRoleGql.MEMBER, {
        "query Messages(": () => ({ messages: { items: [{ id: "m-2", authorId: "me" }] } }),
      });
      await openMenu(makeConversation(), ServerMemberRoleGql.MEMBER);
      fireEvent.click(screen.getByRole("menuitem", { name: "Mark as unread" }));
      await waitFor(() => expect(toast.info).toHaveBeenCalledWith("Nothing here to mark unread"));
      expect(callsTo(requestMock, "mutation MarkAsUnread")).toEqual([]);
    });

    it("is left out while the conversation is unread, and on an older host", async () => {
      serve(ServerMemberRoleGql.MEMBER);
      useUnreadStore.getState().setCounts("ws-1", { "conv-1": 3 }, {});
      await openMenu(makeConversation(), ServerMemberRoleGql.MEMBER);
      expect(menuLabels()).not.toContain("Mark as unread");
      cleanup();
      useUnreadStore.getState().setCounts("ws-1", {});
      await openMenu(makeConversation(), ServerMemberRoleGql.MEMBER);
      expect(menuLabels()).not.toContain("Mark as unread");
    });
  });

  it("offers Mark as read while the conversation has unread messages", async () => {
    serve(ServerMemberRoleGql.MEMBER);
    useUnreadStore.getState().setCounts("ws-1", { "conv-1": 3 });
    await openMenu(makeConversation(), ServerMemberRoleGql.MEMBER);
    expect(menuLabels()[0]).toBe("Mark as read");
    fireEvent.click(screen.getByRole("menuitem", { name: "Mark as read" }));
    await waitFor(() =>
      expect(sentCommands(requestMock)).toEqual([menuRun("chat.mark_as_read", {})]),
    );
    expect(useUnreadStore.getState().counts["conv-1"] ?? 0).toBe(0);
  });

  it("Members toggles the members panel", async () => {
    serve(ServerMemberRoleGql.GUEST);
    await openMenu(makeConversation(), ServerMemberRoleGql.GUEST);
    fireEvent.click(screen.getByRole("menuitem", { name: "Members" }));
    expect(useMembersPanelStore.getState().open).toBe(true);
  });

  it("Invite people opens the members panel with its invite picker", async () => {
    serve(ServerMemberRoleGql.MEMBER);
    await openMenu(makeConversation(), ServerMemberRoleGql.MEMBER);
    fireEvent.click(screen.getByRole("menuitem", { name: "Invite people…" }));
    await waitFor(() =>
      expect(useMembersPanelStore.getState()).toMatchObject({ open: true, invitingIn: "conv-1" }),
    );
    expect(useShellStore.getState().selectedConversationId).toBe("conv-1");
  });

  it("Edit topic starts the header's topic edit from the current topic", async () => {
    serve(ServerMemberRoleGql.MODERATOR);
    await openMenu(makeConversation({ topic: "Daily standup" }), ServerMemberRoleGql.MODERATOR);
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit topic…" }));
    expect(useTopicEditStore.getState()).toMatchObject({
      conversationId: "conv-1",
      draft: "Daily standup",
    });
  });

  it("Assign keybind opens the quick-access assigner for the channel", async () => {
    serve(ServerMemberRoleGql.MEMBER);
    await openMenu(makeConversation(), ServerMemberRoleGql.MEMBER);
    const item = screen.getByRole("menuitem", { name: "Assign keybind…" });
    expect(item).toHaveAttribute("aria-keyshortcuts", "Ctrl+Shift+B");
    fireEvent.click(item);
    await waitFor(() =>
      expect(useQuickAccessStore.getState()).toMatchObject({
        isOpen: true,
        target: { kind: "channel", conversationId: "conv-1", serverId: "ws-1", label: "general" },
      }),
    );
  });
});

describe("ConversationActionsMenu — actions", () => {
  beforeEach(() => {
    requestMock.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    useShellStore.getState().reset();
  });

  it("asks for confirmation before archiving, then archives with the right variables", async () => {
    serve(ServerMemberRoleGql.OWNER);
    await openMenu(makeConversation(), ServerMemberRoleGql.OWNER);
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive channel…" }));

    const dialog = await screen.findByRole("dialog", { name: "Archive #general?" });
    expect(sentCommands(requestMock)).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    await waitFor(() =>
      expect(sentCommands(requestMock)).toEqual([menuRun("chat.archive_channel", {})]),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Archived #general"));
  });

  it("unarchives without a confirmation", async () => {
    serve(ServerMemberRoleGql.MODERATOR);
    await openMenu(makeConversation({ isArchived: true }), ServerMemberRoleGql.MODERATOR);
    fireEvent.click(screen.getByRole("menuitem", { name: "Unarchive channel" }));
    await waitFor(() =>
      expect(sentCommands(requestMock)).toEqual([menuRun("chat.unarchive_channel", {})]),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the server's message when archiving is forbidden", async () => {
    serve(ServerMemberRoleGql.MODERATOR, {
      "mutation ExecuteCommand": () => {
        throw graphqlError("FORBIDDEN", "Only owners and moderators can archive channels");
      },
    });
    await openMenu(makeConversation(), ServerMemberRoleGql.MODERATOR);
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive channel…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Archive" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Could not archive the channel: not done", {
        card: "denied",
        description: "Only owners and moderators can archive channels",
      }),
    );
  });

  it("leaves a public channel straight away and returns to the workspace home", async () => {
    serve(ServerMemberRoleGql.GUEST);
    useShellStore.setState({ selectedConversationId: "conv-1" });
    await openMenu(makeConversation(), ServerMemberRoleGql.GUEST);
    fireEvent.click(screen.getByRole("menuitem", { name: "Leave channel" }));

    await waitFor(() => expect(useShellStore.getState().selectedConversationId).toBeNull());
    expect(sentCommands(requestMock)).toEqual([menuRun("chat.leave_conversation", {})]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Left #general"));
  });

  it("confirms before leaving a private channel", async () => {
    serve(ServerMemberRoleGql.GUEST);
    await openMenu(makeConversation({ isPrivate: true }), ServerMemberRoleGql.GUEST);
    fireEvent.click(screen.getByRole("menuitem", { name: "Leave channel…" }));
    await screen.findByRole("dialog", { name: "Leave #general?" });
    expect(sentCommands(requestMock)).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    await waitFor(() =>
      expect(sentCommands(requestMock)).toEqual([menuRun("chat.leave_conversation", {})]),
    );
    // Asked once: the command's confirmation is the menu's.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("ConversationActionsMenu — slow mode", () => {
  beforeEach(() => {
    requestMock.mockReset();
    vi.mocked(toast.success).mockReset();
    useShellStore.getState().reset();
  });

  it.each([
    ["an ordinary member", ServerMemberRoleGql.MEMBER, makeConversation()],
    ["a guest", ServerMemberRoleGql.GUEST, makeConversation()],
    ["an archived channel", ServerMemberRoleGql.OWNER, makeConversation({ isArchived: true })],
    [
      "a group",
      ServerMemberRoleGql.OWNER,
      makeConversation({ conversationType: ConversationTypeEnum.GROUP, title: "crew" }),
    ],
  ])("is not offered for %s", async (_label, role, conversation) => {
    serve(role);
    await openMenu(conversation, role);
    expect(menuLabels().some((l) => l.startsWith("Slow mode"))).toBe(false);
  });

  it("shows the current interval beside the item", async () => {
    serve(ServerMemberRoleGql.MODERATOR);
    await openMenu(makeConversation({ slowModeSeconds: 300 }), ServerMemberRoleGql.MODERATOR);
    expect(menuLabels()).toContain("Slow mode…: 5 min");
  });

  it("a moderator picks an interval and saves it", async () => {
    serve(ServerMemberRoleGql.MODERATOR);
    await openMenu(makeConversation(), ServerMemberRoleGql.MODERATOR);
    fireEvent.click(screen.getByRole("menuitem", { name: "Slow mode…" }));

    const dialog = await screen.findByRole("dialog", { name: "Slow mode in #general" });
    const options = screen.getAllByRole("radio").map((r) => r.parentElement?.textContent);
    expect(options).toEqual([
      "Off",
      "5 seconds",
      "10 seconds",
      "30 seconds",
      "1 minute",
      "5 minutes",
      "15 minutes",
      "1 hour",
    ]);
    // Saving the current value is pointless.
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "30 seconds" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(sentCommands(requestMock)).toEqual([dialogRun("chat.set_slow_mode", { seconds: 30 })]),
    );
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(toast.success).toHaveBeenCalledWith("Slow mode in #general: 30 seconds");
  });

  it("turns slow mode off", async () => {
    serve(ServerMemberRoleGql.OWNER);
    await openMenu(makeConversation({ slowModeSeconds: 60 }), ServerMemberRoleGql.OWNER);
    fireEvent.click(screen.getByRole("menuitem", { name: "Slow mode…: 1 min" }));
    fireEvent.click(await screen.findByRole("radio", { name: "Off" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(sentCommands(requestMock)).toEqual([dialogRun("chat.set_slow_mode", { seconds: 0 })]),
    );
  });

  it("keeps the dialog open with the server's message on failure", async () => {
    serve(ServerMemberRoleGql.MODERATOR, {
      "mutation ExecuteCommand": () => {
        throw graphqlError("VALIDATION", "slow mode is for channels only");
      },
    });
    await openMenu(makeConversation(), ServerMemberRoleGql.MODERATOR);
    fireEvent.click(screen.getByRole("menuitem", { name: "Slow mode…" }));
    fireEvent.click(await screen.findByRole("radio", { name: "10 seconds" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("slow mode is for channels only");
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe("ConversationActionsMenu — who can post", () => {
  const posting = (policy: PostingPolicy, allowsThreads: boolean) => ({
    id: "conv-1",
    postingPolicy: policy,
    postingAllowsThreads: allowsThreads,
  });

  beforeEach(() => {
    requestMock.mockReset();
    vi.mocked(toast.success).mockReset();
    useShellStore.getState().reset();
  });

  it.each([
    ["an ordinary member", ServerMemberRoleGql.MEMBER, makeConversation()],
    ["an archived channel", ServerMemberRoleGql.OWNER, makeConversation({ isArchived: true })],
  ])("is not offered for %s", async (_label, role, conversation) => {
    serve(role);
    await openMenu(conversation, role);
    expect(menuLabels().some((l) => l.startsWith("Who can post"))).toBe(false);
  });

  it("is not offered once the server refused the posting query", async () => {
    serve(ServerMemberRoleGql.MODERATOR);
    await openMenu(makeConversation(), ServerMemberRoleGql.MODERATOR, (qc) =>
      qc.prefetchQuery({
        queryKey: channelPostingKey("ws-1", "conv-2"),
        queryFn: () => Promise.reject(graphqlError("GRAPHQL_VALIDATION_FAILED", "unknown field")),
        retry: false,
        gcTime: Infinity,
      }),
    );
    expect(menuLabels()).toContain("Slow mode…");
    expect(menuLabels().some((l) => l.startsWith("Who can post"))).toBe(false);
  });

  it("names a moderators-only channel beside the item", async () => {
    serve(ServerMemberRoleGql.MODERATOR);
    await openMenu(makeConversation(), ServerMemberRoleGql.MODERATOR, async (qc) => {
      qc.setQueryData(channelPostingKey("ws-1", "conv-1"), posting(PostingPolicy.MODERATORS, true));
    });
    expect(menuLabels()).toContain("Who can post…: Moderators");
  });

  it("a moderator restricts posting and closes threads", async () => {
    serve(ServerMemberRoleGql.MODERATOR, {
      "query ChannelPosting(": () => ({ conversation: posting(PostingPolicy.EVERYONE, true) }),
    });
    await openMenu(makeConversation(), ServerMemberRoleGql.MODERATOR);
    fireEvent.click(screen.getByRole("menuitem", { name: "Who can post…" }));

    const dialog = await screen.findByRole("dialog", { name: "Who can post in #general" });
    expect(await screen.findByRole("radio", { name: "Everyone" })).toBeChecked();
    const threads = screen.getByRole("checkbox", {
      name: "Others can still react and reply in threads",
    });
    expect(threads).toBeChecked();
    expect(threads).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    fireEvent.click(screen.getByRole("radio", { name: "Owner and moderators" }));
    expect(threads).toBeEnabled();
    fireEvent.click(threads);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(sentCommands(requestMock)).toEqual([
        dialogRun("chat.set_channel_posting", { policy: "moderators", allows_threads: false }),
      ]),
    );
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(toast.success).toHaveBeenCalledWith(
      "Only the owner and moderators can post in #general",
    );
  });

  it("says so when the server does not answer the posting query", async () => {
    serve(ServerMemberRoleGql.OWNER, {
      "query ChannelPosting(": () => {
        throw graphqlError("GRAPHQL_VALIDATION_FAILED", "unknown field");
      },
    });
    await openMenu(makeConversation(), ServerMemberRoleGql.OWNER);
    fireEvent.click(screen.getByRole("menuitem", { name: "Who can post…" }));
    expect(
      await screen.findByText("This workspace's server does not offer posting permissions."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});

describe("ConversationActionsMenu — the agent in an encrypted conversation", () => {
  const encrypted = () =>
    makeConversation({
      conversationType: ConversationTypeEnum.GROUP,
      title: "crew",
      encryptedAt: "2026-10-01T09:00:00Z",
    });

  beforeEach(() => {
    requestMock.mockReset();
    platform.current = "desktop";
    useAgentEncryptedStore.setState({ allowed: {} });
  });

  afterEach(() => {
    platform.current = "web";
  });

  it("is off by default and turns on only after the warning", async () => {
    serve(ServerMemberRoleGql.MEMBER);
    const conversation = encrypted();
    await openMenu(conversation, ServerMemberRoleGql.MEMBER);
    expect(menuLabels()).toContain("Agent: off in this conversation");
    fireEvent.click(screen.getByRole("menuitem", { name: /Agent: off/ }));
    expect(
      screen.getByText(/^The text of this conversation goes to the model provider\./),
    ).toBeInTheDocument();
    expect(useAgentEncryptedStore.getState().allowed).toEqual({});
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    expect(Object.keys(useAgentEncryptedStore.getState().allowed)).toEqual([conversation.id]);
  });

  it("turns off without a warning", async () => {
    serve(ServerMemberRoleGql.MEMBER);
    const conversation = encrypted();
    useAgentEncryptedStore.getState().setAllowed(conversation.id, true);
    await openMenu(conversation, ServerMemberRoleGql.MEMBER);
    fireEvent.click(screen.getByRole("menuitem", { name: /Agent: on/ }));
    expect(useAgentEncryptedStore.getState().allowed).toEqual({});
  });

  it("is not offered for a plaintext conversation", async () => {
    serve(ServerMemberRoleGql.MEMBER);
    await openMenu(makeConversation(), ServerMemberRoleGql.MEMBER);
    expect(menuLabels().some((l) => l.startsWith("Agent"))).toBe(false);
  });

  it("is not offered outside the desktop app, which runs the agent", async () => {
    platform.current = "web";
    serve(ServerMemberRoleGql.MEMBER);
    await openMenu(encrypted(), ServerMemberRoleGql.MEMBER);
    expect(menuLabels().some((l) => l.startsWith("Agent"))).toBe(false);
  });
});

describe("ConversationActionsMenu — ask an agent", () => {
  beforeEach(() => {
    requestMock.mockReset();
    platform.current = "desktop";
    useAuthStore.setState({ session: { userId: "me" } });
  });

  afterEach(() => {
    platform.current = "web";
    resetAskAgent();
    useAuthStore.setState({ session: null });
  });

  it("asks about the menu's channel, through its command, in the desktop app", async () => {
    serve(ServerMemberRoleGql.MEMBER);
    await openMenu(makeConversation(), ServerMemberRoleGql.MEMBER);
    fireEvent.click(screen.getByRole("menuitem", { name: "Ask agent about #general" }));
    await waitFor(() =>
      expect(useAskAgentStore.getState().choosing).toEqual({
        workspaceId: "ws-1",
        conversationId: "conv-1",
        messageId: null,
        channelName: "general",
        workspaceName: "this workspace",
      }),
    );
  });

  it("is not offered in the web app", async () => {
    platform.current = "web";
    serve(ServerMemberRoleGql.MEMBER);
    await openMenu(makeConversation(), ServerMemberRoleGql.MEMBER);
    expect(menuLabels().some((l) => l.startsWith("Ask agent"))).toBe(false);
  });

  it.each([
    ["a direct message", { conversationType: ConversationTypeEnum.DIRECT, title: null }],
    ["a group", { conversationType: ConversationTypeEnum.GROUP, title: "crew" }],
    ["an encrypted channel", { encryptedAt: "2026-10-01T09:00:00Z" }],
    ["an archived channel", { isArchived: true }],
  ])("is not offered for %s", async (_what, overrides) => {
    serve(ServerMemberRoleGql.MEMBER);
    await openMenu(makeConversation(overrides), ServerMemberRoleGql.MEMBER);
    expect(menuLabels().some((l) => l.startsWith("Ask agent"))).toBe(false);
  });
});

describe("ConversationActionsMenu — new webhook", () => {
  const withWebhooks = fakeServerInfo({}, { capabilities: [INCOMING_WEBHOOKS] });
  const bot = (extra: Record<string, unknown> = {}) => ({
    userId: "bot-1",
    serverId: "ws-1",
    name: "Deploy bot",
    runBy: "Team",
    readsGoTo: "Server",
    addedByName: "Ivana",
    createdAt: "2026-11-01T00:00:00Z",
    deactivatedAt: null,
    ...extra,
  });
  const hook = (extra: Record<string, unknown> = {}) => ({
    id: "h-1",
    conversationId: "conv-1",
    botUserId: "bot-1",
    preset: "PLAIN",
    createdAt: "2026-11-01T00:00:00Z",
    lastUsedAt: null,
    revokedAt: null,
    ...extra,
  });
  const serveBots = (
    role: ServerMemberRoleGql,
    bots: unknown[],
    hooks: unknown[],
    overrides: Record<string, () => unknown> = {},
  ) =>
    serve(role, {
      "query Bots(": () => ({ bots }),
      "query IncomingWebhooks": () => ({ incomingWebhooks: hooks }),
      ...overrides,
    });

  beforeEach(() => {
    requestMock.mockReset();
    useShellStore.getState().reset();
    useAuthStore.setState({ session: { userId: "me" } });
  });

  afterEach(() => {
    useShellStore.getState().reset();
    useAuthStore.setState({ session: null });
    useRelayStore.setState({ info: null });
  });

  const offered = () => menuLabels().includes("New webhook…");

  it.each([ServerMemberRoleGql.OWNER, ServerMemberRoleGql.MODERATOR])(
    "is offered to a %s of a plaintext channel, in the Moderation section",
    async (role) => {
      serve(role);
      await openMenu(makeConversation(), role, undefined, withWebhooks);
      const labels = menuLabels();
      expect(labels).toContain("New webhook…");
      expect(labels.indexOf("New webhook…")).toBeGreaterThan(labels.indexOf("Slow mode…"));
      expect(labels.indexOf("New webhook…")).toBeLessThan(labels.indexOf("Archive channel…"));
    },
  );

  it.each([
    ["a member", ServerMemberRoleGql.MEMBER, makeConversation(), withWebhooks],
    ["a guest", ServerMemberRoleGql.GUEST, makeConversation(), withWebhooks],
    [
      "an encrypted channel",
      ServerMemberRoleGql.OWNER,
      makeConversation({ encryptedAt: "2026-11-01T00:00:00Z" }),
      withWebhooks,
    ],
    [
      "an archived channel",
      ServerMemberRoleGql.OWNER,
      makeConversation({ isArchived: true }),
      withWebhooks,
    ],
    [
      "a group",
      ServerMemberRoleGql.OWNER,
      makeConversation({ conversationType: ConversationTypeEnum.GROUP, title: "crew" }),
      withWebhooks,
    ],
    [
      "a direct message",
      ServerMemberRoleGql.OWNER,
      makeConversation({ conversationType: ConversationTypeEnum.DIRECT, title: null }),
      withWebhooks,
    ],
    [
      "a host without incoming_webhooks",
      ServerMemberRoleGql.OWNER,
      makeConversation(),
      fakeServerInfo({}, { capabilities: [] }),
    ],
    [
      "the bots feature off",
      ServerMemberRoleGql.OWNER,
      makeConversation(),
      fakeServerInfo({ bots: ServerFeatureState.DISABLED }, { capabilities: [INCOMING_WEBHOOKS] }),
    ],
  ])("is not offered for %s", async (_label, role, conversation, info) => {
    serve(role);
    await openMenu(conversation, role, undefined, info);
    expect(offered()).toBe(false);
  });

  it("is not offered in the direct space", async () => {
    useRelayStore.setState({ info: { serverId: "relay", roles: [], directSpaceId: "ws-1" } });
    serve(ServerMemberRoleGql.OWNER);
    await openMenu(makeConversation(), ServerMemberRoleGql.OWNER, undefined, withWebhooks);
    expect(offered()).toBe(false);
  });

  /** Chooses New webhook… and waits for its dialog, which is replaced as the lists load. */
  async function openDialog() {
    await openMenu(makeConversation(), ServerMemberRoleGql.OWNER, undefined, withWebhooks);
    fireEvent.click(screen.getByRole("menuitem", { name: "New webhook…" }));
    await screen.findByRole("dialog", { name: "New incoming webhook" });
  }

  it("asks nothing from the server until the item is chosen", async () => {
    serveBots(ServerMemberRoleGql.OWNER, [bot()], []);
    await openMenu(makeConversation(), ServerMemberRoleGql.OWNER, undefined, withWebhooks);
    expect(callsTo(requestMock, "query IncomingWebhooks")).toEqual([]);
    expect(callsTo(requestMock, "query Bots(")).toEqual([]);
  });

  it("shows the channel as fixed text and says the bot is added to it", async () => {
    serveBots(ServerMemberRoleGql.OWNER, [bot()], []);
    await openDialog();
    await screen.findByRole("button", { name: "Create webhook" });
    expect(screen.queryByLabelText("Channel")).not.toBeInTheDocument();
    expect(screen.getByText("general")).toBeInTheDocument();
    expect(screen.getByLabelText("Bot")).toBeInTheDocument();
    expect(screen.getByLabelText("Preset")).toBeInTheDocument();
    expect(screen.getByText(/added to the channel if it is not in it/)).toBeInTheDocument();
  });

  it("shows a channel name's invisible characters", async () => {
    serveBots(ServerMemberRoleGql.OWNER, [bot()], []);
    await openMenu(
      makeConversation({ title: "ge\u202Eneral" }),
      ServerMemberRoleGql.OWNER,
      undefined,
      withWebhooks,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "New webhook…" }));
    expect(await screen.findByText("ge⟦U+202E⟧neral")).toBeInTheDocument();
  });

  it("says while it loads, then shows an error with a retry", async () => {
    let fail = true;
    serveBots(ServerMemberRoleGql.OWNER, [bot()], [], {
      "query IncomingWebhooks": () => {
        if (fail) throw graphqlError("FORBIDDEN", "Not for you");
        return { incomingWebhooks: [] };
      },
    });
    await openDialog();
    expect(await screen.findByText("Not for you")).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: "Create webhook" })).toBeVisible();
  });

  it("says the channel already has a webhook and links to Settings > Bots", async () => {
    serveBots(ServerMemberRoleGql.OWNER, [bot()], [hook()]);
    await openDialog();
    expect(await screen.findByText("This channel already has a webhook.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Create webhook" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open Bots" }));
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "settings", tab: "bots" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ignores a revoked webhook and another channel's webhook", async () => {
    serveBots(
      ServerMemberRoleGql.OWNER,
      [bot()],
      [hook({ revokedAt: "x" }), hook({ id: "h-2", conversationId: "other" })],
    );
    await openDialog();
    expect(await screen.findByRole("button", { name: "Create webhook" })).toBeVisible();
  });

  it("says a webhook posts as a bot when no bot is active, without making one", async () => {
    serveBots(ServerMemberRoleGql.OWNER, [bot({ deactivatedAt: "x" })], []);
    await openDialog();
    expect(
      await screen.findByText("A webhook posts as a bot, and this workspace has none yet."),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Open Bots" }));
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "settings", tab: "bots" });
    expect(callsTo(requestMock, "mutation CreateBot")).toEqual([]);
  });

  it("creates the webhook for the channel and shows its URL once", async () => {
    serveBots(ServerMemberRoleGql.OWNER, [bot()], [], {
      "mutation CreateIncomingWebhook": () => ({
        createIncomingWebhook: { webhook: hook(), token: "rimhook_TOKEN" },
      }),
    });
    await openDialog();
    fireEvent.change(await screen.findByLabelText("Preset"), {
      target: { value: "GITHUB" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create webhook" }));
    expect(
      await screen.findByDisplayValue("https://rim.example/api/hooks/rimhook_TOKEN"),
    ).toBeInTheDocument();
    expect(callsTo(requestMock, "mutation CreateIncomingWebhook")).toEqual([
      { input: { conversationId: "conv-1", botUserId: "bot-1", preset: "GITHUB" } },
    ]);
    expect(screen.getByText(/Payload URL/)).toBeInTheDocument();
    // The refetched list now holds the webhook; the URL stays until Done.
    await waitFor(() =>
      expect(callsTo(requestMock, "query IncomingWebhooks").length).toBeGreaterThan(0),
    );
    expect(screen.getByDisplayValue(/rimhook_TOKEN/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByDisplayValue(/rimhook_TOKEN/)).not.toBeInTheDocument();
  });

  it("shows a refusal and keeps the form", async () => {
    serveBots(ServerMemberRoleGql.OWNER, [bot()], [], {
      "mutation CreateIncomingWebhook": () => {
        throw graphqlError("CONFLICT", "The channel already has a webhook");
      },
    });
    await openDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Create webhook" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The channel already has a webhook");
    expect(screen.getByRole("button", { name: "Create webhook" })).toBeVisible();
  });
});
