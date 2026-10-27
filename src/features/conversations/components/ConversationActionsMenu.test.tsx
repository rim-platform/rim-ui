import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";

import { createTestQueryClient } from "../../../test/utils";
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
} from "../__fixtures__/conversations";
import { useMembersPanelStore } from "../state/useMembersPanelStore";
import { useAgentEncryptedStore } from "../../agent/state/useAgentEncryptedStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useQuickAccessStore } from "../../commands/state/useQuickAccessStore";
import { useTopicEditStore } from "../state/useTopicEditStore";
import { useUnreadStore } from "../state/useUnreadStore";

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

import { ConversationActionsMenu } from "./ConversationActionsMenu";
import { channelPostingKey } from "../api/useChannelPosting";

function serve(role: ServerMemberRoleGql, overrides: Record<string, () => unknown> = {}) {
  routeRequests(requestMock, {
    "query Server(": () => ({ server: { id: "ws-1", name: "Acme", viewerRole: role } }),
    "mutation LeaveConversation": () => ({ leaveConversation: true }),
    "mutation SetConversationArchived": () => ({
      setConversationArchived: makeConversation({ isArchived: true }),
    }),
    ...overrides,
  });
}

async function openMenu(
  conversation: ConversationSummary,
  role: ServerMemberRoleGql,
  seed?: (qc: QueryClient) => Promise<void>,
) {
  const qc = createTestQueryClient();
  render(
    <QueryClientProvider client={qc}>
      <ConversationActionsMenu workspaceId="ws-1" conversation={conversation} />
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
    serve(ServerMemberRoleGql.MEMBER, {
      "mutation JoinChannel": () => ({ joinChannel: makeConversation() }),
    });
    await openMenu(makeConversation({ isMember: false }), ServerMemberRoleGql.MEMBER);
    expect(menuLabels()).toEqual(["Join channel", "Members", "Assign keybind…"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Join channel" }));
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation JoinChannel")).toEqual([
        { serverId: "ws-1", conversationId: "conv-1" },
      ]),
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

  it("offers Mark as read while the conversation has unread messages", async () => {
    serve(ServerMemberRoleGql.MEMBER, { "mutation MarkAsRead": () => ({ markAsRead: true }) });
    useUnreadStore.getState().setCounts("ws-1", { "conv-1": 3 });
    await openMenu(makeConversation(), ServerMemberRoleGql.MEMBER);
    expect(menuLabels()[0]).toBe("Mark as read");
    fireEvent.click(screen.getByRole("menuitem", { name: "Mark as read" }));
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation MarkAsRead")).toEqual([
        { input: expect.objectContaining({ conversationId: "conv-1", workspaceId: "ws-1" }) },
      ]),
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
    expect(useMembersPanelStore.getState()).toMatchObject({ open: true, invitingIn: "conv-1" });
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
    expect(useQuickAccessStore.getState()).toMatchObject({
      isOpen: true,
      target: { kind: "channel", conversationId: "conv-1", serverId: "ws-1", label: "general" },
    });
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
    expect(callsTo(requestMock, "mutation SetConversationArchived")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(callsTo(requestMock, "mutation SetConversationArchived")).toEqual([
      { serverId: "ws-1", conversationId: "conv-1", archived: true },
    ]);
  });

  it("unarchives without a confirmation", async () => {
    serve(ServerMemberRoleGql.MODERATOR, {
      "mutation SetConversationArchived": () => ({
        setConversationArchived: makeConversation(),
      }),
    });
    await openMenu(makeConversation({ isArchived: true }), ServerMemberRoleGql.MODERATOR);
    fireEvent.click(screen.getByRole("menuitem", { name: "Unarchive channel" }));
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation SetConversationArchived")).toEqual([
        { serverId: "ws-1", conversationId: "conv-1", archived: false },
      ]),
    );
  });

  it("shows the server's message when archiving is forbidden", async () => {
    serve(ServerMemberRoleGql.MODERATOR, {
      "mutation SetConversationArchived": () => {
        throw graphqlError("FORBIDDEN", "Only owners and moderators can archive channels");
      },
    });
    await openMenu(makeConversation(), ServerMemberRoleGql.MODERATOR);
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive channel…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Archive" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Only owners and moderators can archive channels"),
    );
  });

  it("leaves a public channel straight away and returns to the workspace home", async () => {
    serve(ServerMemberRoleGql.GUEST);
    useShellStore.setState({ selectedConversationId: "conv-1" });
    await openMenu(makeConversation(), ServerMemberRoleGql.GUEST);
    fireEvent.click(screen.getByRole("menuitem", { name: "Leave channel" }));

    await waitFor(() => expect(useShellStore.getState().selectedConversationId).toBeNull());
    expect(callsTo(requestMock, "mutation LeaveConversation")).toEqual([
      { serverId: "ws-1", conversationId: "conv-1" },
    ]);
    expect(toast.success).toHaveBeenCalledWith("Left #general");
  });

  it("confirms before leaving a private channel", async () => {
    serve(ServerMemberRoleGql.GUEST);
    await openMenu(makeConversation({ isPrivate: true }), ServerMemberRoleGql.GUEST);
    fireEvent.click(screen.getByRole("menuitem", { name: "Leave channel…" }));
    await screen.findByRole("dialog", { name: "Leave #general?" });
    expect(callsTo(requestMock, "mutation LeaveConversation")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    await waitFor(() => expect(callsTo(requestMock, "mutation LeaveConversation")).toHaveLength(1));
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
    serve(ServerMemberRoleGql.MODERATOR, {
      "mutation SetSlowMode": () => ({ setSlowMode: makeConversation({ slowModeSeconds: 30 }) }),
    });
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
      expect(callsTo(requestMock, "mutation SetSlowMode")).toEqual([
        { serverId: "ws-1", conversationId: "conv-1", seconds: 30 },
      ]),
    );
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(toast.success).toHaveBeenCalledWith("Slow mode in #general: 30 seconds");
  });

  it("turns slow mode off", async () => {
    serve(ServerMemberRoleGql.OWNER, {
      "mutation SetSlowMode": () => ({ setSlowMode: makeConversation() }),
    });
    await openMenu(makeConversation({ slowModeSeconds: 60 }), ServerMemberRoleGql.OWNER);
    fireEvent.click(screen.getByRole("menuitem", { name: "Slow mode…: 1 min" }));
    fireEvent.click(await screen.findByRole("radio", { name: "Off" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation SetSlowMode")).toEqual([
        { serverId: "ws-1", conversationId: "conv-1", seconds: 0 },
      ]),
    );
  });

  it("keeps the dialog open with the server's message on failure", async () => {
    serve(ServerMemberRoleGql.MODERATOR, {
      "mutation SetSlowMode": () => {
        throw graphqlError("VALIDATION", "slow mode is for channels only");
      },
    });
    await openMenu(makeConversation(), ServerMemberRoleGql.MODERATOR);
    fireEvent.click(screen.getByRole("menuitem", { name: "Slow mode…" }));
    fireEvent.click(await screen.findByRole("radio", { name: "10 seconds" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("slow mode is for channels only");
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
      "mutation SetChannelPosting": () => ({
        setChannelPosting: posting(PostingPolicy.MODERATORS, false),
      }),
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
      expect(callsTo(requestMock, "mutation SetChannelPosting")).toEqual([
        {
          serverId: "ws-1",
          conversationId: "conv-1",
          policy: PostingPolicy.MODERATORS,
          allowsThreads: false,
        },
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
