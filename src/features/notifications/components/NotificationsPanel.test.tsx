import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { createTestQueryClient } from "../../../test/utils";
import {
  ConversationTypeEnum,
  NotificationReason,
} from "../../../core/graphql/generated/schema-types";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import {
  baseReadHandlers,
  callsTo,
  routeRequests,
  workspaceMembers,
} from "../../conversations/__fixtures__/conversations";
import type { NotificationItem, NotificationPage } from "../api/useNotifications";
import { useBlockedConversations } from "../../relay/state/useBlockedConversations";
import { useNotificationsPanelStore } from "../state/useNotificationsPanelStore";

const requestMock = vi.fn();
const storeAccountMock = vi.fn((): unknown => null);
const readCachedMessageMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));
vi.mock("../../messages/api/messageCache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../messages/api/messageCache")>()),
  encryptedStoreAccount: () => storeAccountMock(),
  readCachedMessage: (...args: unknown[]) => readCachedMessageMock(...args),
}));
vi.mock("../../../shared/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));

import { NotificationsPanel } from "./NotificationsPanel";
import { NotificationBellButton } from "./NotificationBellButton";

function notification(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: "n-1",
    serverId: "ws-1",
    conversationId: "c-general",
    messageId: "m-1",
    reason: NotificationReason.MENTION,
    createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    readAt: null,
    conversation: {
      id: "c-general",
      title: "general",
      conversationType: ConversationTypeEnum.CHANNEL,
      memberIds: [],
    },
    message: {
      id: "m-1",
      conversationId: "c-general",
      threadId: null,
      authorId: "u-alice",
      author: { id: "u-alice", username: "alice", displayName: "Alice" },
      text: "can you look at the deploy?",
      isDeleted: false,
      sentAt: new Date().toISOString(),
      encryption: null,
    },
    ...overrides,
  };
}

const keyword = notification({
  id: "n-2",
  messageId: "m-2",
  reason: NotificationReason.KEYWORD,
  readAt: "2026-10-05T09:00:00Z",
  message: {
    id: "m-2",
    conversationId: "c-general",
    threadId: null,
    authorId: "u-bob",
    author: null,
    text: "outage in eu-west",
    isDeleted: false,
    sentAt: "2026-10-05T08:00:00Z",
    encryption: null,
  },
});

const unavailable = notification({
  id: "n-3",
  conversationId: "c-secret",
  messageId: "m-3",
  reason: NotificationReason.ALL,
  conversation: null,
  message: null,
});

function page(items: NotificationItem[], next: NotificationPage["next"] = null): NotificationPage {
  return { items, next, pageInfo: { hasNext: next !== null, hasPrev: false } };
}

type Handler = (vars: Record<string, unknown>) => unknown;

function serve(pages: Handler, extra: Record<string, Handler> = {}) {
  routeRequests(requestMock, {
    ...baseReadHandlers,
    "query MyNotifications": (vars) => ({ myNotifications: pages(vars) }),
    "mutation MarkNotificationsRead": () => ({ markNotificationsRead: 1 }),
    "query MyUnreadNotificationCount": () => ({ myUnreadNotificationCount: 1 }),
    ...extra,
  });
}

function renderPanel() {
  const qc = createTestQueryClient();
  render(
    <QueryClientProvider client={qc}>
      <NotificationsPanel workspaceId="ws-1" onClose={vi.fn()} />
    </QueryClientProvider>,
  );
  return qc;
}

function row(text: string): HTMLElement {
  const match = screen.getAllByRole("listitem").find((li) => li.textContent?.includes(text));
  if (!match) throw new Error(`no notification row with ${text}`);
  return within(match).getByRole("button");
}

describe("NotificationsPanel", () => {
  beforeEach(() => {
    requestMock.mockReset();
    storeAccountMock.mockReset().mockReturnValue(null);
    readCachedMessageMock.mockReset();
    useShellStore.getState().reset();
    useAuthStore.setState({ session: { userId: "me" } });
    useNotificationsPanelStore.setState({ open: true, unreadOnly: false });
  });

  afterEach(() => {
    useAuthStore.setState({ session: null });
  });

  it("lists entries with reason, conversation, author, snippet, time and unread dot", async () => {
    serve(() => page([notification(), keyword]));
    renderPanel();

    const first = await screen.findByText("can you look at the deploy?");
    const mention = first.closest("button") as HTMLElement;
    expect(mention).toHaveTextContent("Mention");
    expect(mention).toHaveTextContent("#general");
    expect(mention).toHaveTextContent("Alice");
    expect(mention).toHaveTextContent("5m ago");
    expect(within(mention).getByText("Unread")).toBeInTheDocument();

    const kw = row("outage in eu-west");
    expect(kw).toHaveTextContent("Keyword");
    expect(kw).toHaveTextContent("Bob");
    expect(within(kw).queryByText("Unread")).not.toBeInTheDocument();

    expect(callsTo(requestMock, "query MyNotifications")[0]).toEqual({
      serverId: "ws-1",
      unreadOnly: false,
      dir: "AFTER",
      cursor: null,
      limit: 30,
    });
  });

  it("lists no entry of a hidden conversation", async () => {
    useBlockedConversations.getState().reset();
    useBlockedConversations.getState().setIn("ws-1", { "c-hidden": "rimp1_alice" });
    const hidden = notification({
      id: "n-hidden",
      conversationId: "c-hidden",
      message: { ...notification().message!, id: "m-hidden", text: "secret from a blocked person" },
    });
    serve(() => page([notification(), hidden]));
    renderPanel();

    await screen.findByText("can you look at the deploy?");
    expect(screen.queryByText("secret from a blocked person")).not.toBeInTheDocument();
    useBlockedConversations.getState().reset();
  });

  it("shows an encrypted message's text from this device's store, or that it is encrypted", async () => {
    const account = { endpoint: "http://localhost:8080/api", userId: "me" };
    storeAccountMock.mockReturnValue(account);
    readCachedMessageMock.mockImplementation((_account: unknown, id: string) =>
      Promise.resolve(
        id === "m-read"
          ? { id, text: "whatsup buddy", e2ee: { status: "decrypted" } }
          : id === "m-placeholder"
            ? { id, text: "", e2ee: { status: "undecryptable" } }
            : null,
      ),
    );
    const encrypted = (id: string) =>
      notification({
        id: `n-${id}`,
        messageId: id,
        reason: NotificationReason.DIRECT,
        message: {
          ...notification().message!,
          id,
          text: null,
          encryption: { sentAtUs: "1792957000000000" },
        },
      });
    serve(() => page([encrypted("m-read"), encrypted("m-placeholder"), encrypted("m-unsynced")]));
    renderPanel();

    expect(await screen.findByText("whatsup buddy")).toBeInTheDocument();
    expect(screen.getAllByText("Encrypted message")).toHaveLength(2);
    expect(screen.queryByText("Attachment")).not.toBeInTheDocument();
    expect(readCachedMessageMock).toHaveBeenCalledWith(account, "m-read");
  });

  it("shows the preview as plain text with mentions named", async () => {
    storeAccountMock.mockReturnValue({ endpoint: "http://localhost:8080/api", userId: "me" });
    readCachedMessageMock.mockResolvedValue({
      id: "m-e2ee",
      text: "_ping_ <@rimp1_bob>",
      e2ee: { status: "decrypted" },
    });
    const reaction = notification({
      reason: NotificationReason.REACTION,
      message: {
        ...notification().message!,
        text: "**Release 2.1** is out, <@u-bob> please check with <@u-gone>",
      },
    });
    const encrypted = notification({
      id: "n-e2ee",
      messageId: "m-e2ee",
      reason: NotificationReason.DIRECT,
      message: {
        ...notification().message!,
        id: "m-e2ee",
        text: null,
        encryption: { sentAtUs: "1792957000000000" },
      },
    });
    serve(() => page([reaction, encrypted]), {
      "query ServerMembers": () => ({
        serverMembers: workspaceMembers.map((m) =>
          m.userId === "u-bob" ? { ...m, principalId: "rimp1_bob" } : m,
        ),
      }),
    });
    renderPanel();

    expect(
      await screen.findByText("Release 2.1 is out, @Bob please check with @member"),
    ).toBeInTheDocument();
    expect(await screen.findByText("ping @Bob")).toBeInTheDocument();
    expect(screen.queryByText(/<@/)).not.toBeInTheDocument();
  });

  it("shows HTML, tables and task boxes in a preview as plain text", async () => {
    serve(() =>
      page([
        notification({
          message: {
            ...notification().message!,
            text: "<b>raw html</b><script>alert(1)</script>\n\n| a | b |\n|---|---|\n\n- [ ] todo",
          },
        }),
      ]),
    );
    renderPanel();

    expect(await screen.findByText("raw html a b todo")).toBeInTheDocument();
    expect(screen.queryByText(/<b>|\||\[ \]/)).not.toBeInTheDocument();
  });

  it("keeps the reason on one line and names the whole conversation on hover", async () => {
    serve(() =>
      page([
        notification({
          reason: NotificationReason.ALL,
          conversation: { ...notification().conversation!, title: "a-very-long-channel-name" },
        }),
      ]),
    );
    renderPanel();

    const reason = await screen.findByText("New message");
    expect(reason).toHaveClass("shrink-0", "whitespace-nowrap");
    const conversation = screen.getByText("#a-very-long-channel-name");
    expect(conversation).toHaveAttribute("title", "#a-very-long-channel-name");
  });

  it("the Unread only filter asks the server for unread entries", async () => {
    serve((vars) => page(vars.unreadOnly ? [notification()] : [notification(), keyword]));
    renderPanel();
    await screen.findByText("outage in eu-west");

    fireEvent.click(screen.getByRole("button", { name: "Unread only" }));

    await waitFor(() => expect(screen.queryByText("outage in eu-west")).not.toBeInTheDocument());
    expect(callsTo(requestMock, "query MyNotifications").at(-1)).toMatchObject({
      unreadOnly: true,
    });
    expect(screen.getByRole("button", { name: "Unread only" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("clicking an entry opens its message and marks it read", async () => {
    let read = false;
    serve(() => page([notification({ readAt: read ? "2026-10-05T10:00:00Z" : null })]), {
      "mutation MarkNotificationsRead": () => {
        read = true;
        return { markNotificationsRead: 1 };
      },
    });
    renderPanel();
    fireEvent.click(await screen.findByText("can you look at the deploy?"));

    await waitFor(() =>
      expect(callsTo(requestMock, "mutation MarkNotificationsRead")).toEqual([
        { serverId: "ws-1", ids: ["n-1"], allBefore: null },
      ]),
    );
    const shell = useShellStore.getState();
    expect(shell.mainSurface).toEqual({ kind: "conversation" });
    expect(shell.selectedConversationId).toBe("c-general");
    expect(shell.highlightedMessageId).toBe("m-1");
    await waitFor(() => expect(screen.queryByText("Unread")).not.toBeInTheDocument());
  });

  it("a thread reply opens the thread on its root, then highlights the reply", async () => {
    serve(
      () =>
        page([
          notification({
            reason: NotificationReason.THREAD_REPLY,
            message: { ...notification().message!, threadId: "t-1" },
          }),
        ]),
      {
        "query NotificationThreadRoot": () => ({ thread: { id: "t-1", rootMessageId: "m-root" } }),
      },
    );
    renderPanel();
    fireEvent.click(await screen.findByText("can you look at the deploy?"));

    await waitFor(() => expect(useShellStore.getState().highlightedMessageId).toBe("m-1"));
    const shell = useShellStore.getState();
    expect(shell.selectedConversationId).toBe("c-general");
    expect(shell.isThreadOpen).toBe(true);
    expect(shell.selectedRootMessageId).toBe("m-root");
    expect(callsTo(requestMock, "query NotificationThreadRoot")).toEqual([
      { serverId: "ws-1", conversationId: "c-general", threadId: "t-1" },
    ]);
  });

  it("Mark all read sends allBefore: now", async () => {
    serve(() => page([notification()]));
    renderPanel();
    await screen.findByText("can you look at the deploy?");

    const before = Date.now();
    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));

    await waitFor(() =>
      expect(callsTo(requestMock, "mutation MarkNotificationsRead")).toHaveLength(1),
    );
    const vars = callsTo(requestMock, "mutation MarkNotificationsRead")[0];
    expect(vars).toMatchObject({ serverId: "ws-1", ids: null });
    const allBefore = Date.parse(vars.allBefore as string);
    expect(allBefore).toBeGreaterThanOrEqual(before);
    expect(allBefore).toBeLessThanOrEqual(Date.now());
  });

  it("Load more walks to older entries with the next cursor", async () => {
    const cursor = { createdAt: "2026-10-05T08:00:00Z", notificationId: "n-2" };
    serve((vars) => (vars.cursor ? page([unavailable]) : page([notification(), keyword], cursor)));
    renderPanel();
    await screen.findByText("outage in eu-west");

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByText("No longer available")).toBeInTheDocument();
    expect(callsTo(requestMock, "query MyNotifications")[1]).toMatchObject({
      dir: "AFTER",
      cursor,
    });
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("an entry the viewer can no longer read says so and can still be marked read", async () => {
    serve(() => page([unavailable]));
    renderPanel();

    const entry = (await screen.findByText("No longer available")).closest("button") as HTMLElement;
    fireEvent.click(entry);

    await waitFor(() =>
      expect(callsTo(requestMock, "mutation MarkNotificationsRead")).toEqual([
        { serverId: "ws-1", ids: ["n-3"], allBefore: null },
      ]),
    );
    expect(useShellStore.getState().selectedConversationId).toBeNull();
    expect(useShellStore.getState().highlightedMessageId).toBeNull();
  });
});

describe("NotificationBellButton", () => {
  beforeEach(() => {
    requestMock.mockReset();
    useShellStore.getState().reset();
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useNotificationsPanelStore.setState({ open: false, unreadOnly: false });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
  });

  it("shows the unread count and refetches it when invalidated", async () => {
    let count = 3;
    routeRequests(requestMock, {
      "query MyUnreadNotificationCount": () => ({ myUnreadNotificationCount: count }),
    });
    const qc = createTestQueryClient();
    render(
      <QueryClientProvider client={qc}>
        <NotificationBellButton />
      </QueryClientProvider>,
    );

    const bell = await screen.findByRole("button", { name: "Notifications (3 unread)" });
    expect(bell).toHaveTextContent("3");
    expect(callsTo(requestMock, "query MyUnreadNotificationCount")).toEqual([{ serverId: "ws-1" }]);

    count = 0;
    await qc.invalidateQueries({ queryKey: ["unreadNotificationCount", "ws-1"] });
    expect(await screen.findByRole("button", { name: "Notifications" })).not.toHaveTextContent("3");
  });

  it("toggles the inbox and returns to the conversation surface", async () => {
    routeRequests(requestMock, {
      "query MyUnreadNotificationCount": () => ({ myUnreadNotificationCount: 0 }),
    });
    useShellStore.setState({ mainSurface: { kind: "settings" } });
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <NotificationBellButton />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "conversation" });
    expect(useNotificationsPanelStore.getState().open).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(useNotificationsPanelStore.getState().open).toBe(false);
  });
});

describe("NotificationsPanel — entry context menu", () => {
  beforeEach(() => {
    requestMock.mockReset();
    useShellStore.getState().reset();
    useAuthStore.setState({ session: { userId: "me" } });
    useNotificationsPanelStore.setState({ open: true, unreadOnly: false });
  });

  afterEach(() => {
    useAuthStore.setState({ session: null });
  });

  function labels(): string[] {
    return screen.getAllByRole("menuitem").map((el) => el.textContent ?? "");
  }

  it("offers Mark as read, Mute conversation and Open on an unread entry", async () => {
    serve(() => page([notification()]));
    renderPanel();
    fireEvent.contextMenu(await screen.findByText("can you look at the deploy?"));
    expect(labels()).toEqual(["Mark as read", "Mute conversation", "Open"]);
  });

  it("offers no Mark as read on a read entry", async () => {
    serve(() => page([keyword]));
    renderPanel();
    fireEvent.contextMenu(await screen.findByText("outage in eu-west"));
    expect(labels()).toEqual(["Mute conversation", "Open"]);
  });

  it("offers only Mark as read on an entry whose conversation is gone", async () => {
    serve(() => page([unavailable]));
    renderPanel();
    fireEvent.contextMenu(await screen.findByText("No longer available"));
    expect(labels()).toEqual(["Mark as read"]);
  });

  it("marks only that entry read", async () => {
    serve(() => page([notification()]));
    renderPanel();
    fireEvent.contextMenu(await screen.findByText("can you look at the deploy?"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Mark as read" }));
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation MarkNotificationsRead")).toEqual([
        { serverId: "ws-1", ids: ["n-1"], allBefore: null },
      ]),
    );
    expect(useShellStore.getState().selectedConversationId).toBeNull();
  });

  it("mutes the conversation for the duration chosen in the submenu", async () => {
    serve(() => page([notification()]), {
      "mutation MuteConversation": () => ({ muteConversation: true }),
    });
    renderPanel();
    fireEvent.contextMenu(await screen.findByText("can you look at the deploy?"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Mute conversation" }));
    const submenu = screen.getByRole("menu", { name: "Mute conversation" });
    expect(
      within(submenu)
        .getAllByRole("menuitem")
        .map((el) => el.textContent),
    ).toEqual(["Mute for 1 hour", "Mute for 8 hours", "Mute until tomorrow"]);
    const before = Date.now();
    fireEvent.click(within(submenu).getByRole("menuitem", { name: "Mute for 1 hour" }));

    await waitFor(() => expect(callsTo(requestMock, "mutation MuteConversation")).toHaveLength(1));
    const { input } = callsTo(requestMock, "mutation MuteConversation")[0] as {
      input: { serverId: string; conversationId: string; mutedUntil: string };
    };
    expect(input.serverId).toBe("ws-1");
    expect(input.conversationId).toBe("c-general");
    expect(Date.parse(input.mutedUntil) - before).toBeGreaterThanOrEqual(59 * 60 * 1000);
  });

  it("offers Unmute conversation while the conversation is muted", async () => {
    serve(() => page([notification()]), {
      "query MutedConversations": () => ({
        mutedConversations: [{ conversationId: "c-general", mutedUntil: null }],
      }),
      "mutation UnmuteConversation": () => ({ unmuteConversation: true }),
    });
    renderPanel();
    const entry = await screen.findByText("can you look at the deploy?");
    await waitFor(() => expect(callsTo(requestMock, "query MutedConversations")).toHaveLength(1));
    await waitFor(() => {
      fireEvent.contextMenu(entry);
      expect(labels()).toContain("Unmute conversation");
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Unmute conversation" }));
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation UnmuteConversation")).toEqual([
        { input: { serverId: "ws-1", conversationId: "c-general" } },
      ]),
    );
  });

  it("opens the entry from the menu, and from the keyboard", async () => {
    serve(() => page([notification()]));
    renderPanel();
    await screen.findByText("can you look at the deploy?");
    fireEvent.keyDown(row("can you look at the deploy?"), { key: "ContextMenu" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Open" }));
    await waitFor(() => expect(useShellStore.getState().selectedConversationId).toBe("c-general"));
    expect(useShellStore.getState().highlightedMessageId).toBe("m-1");
  });
});
