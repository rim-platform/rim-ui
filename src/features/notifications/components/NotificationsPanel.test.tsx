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
} from "../../conversations/__fixtures__/conversations";
import type { NotificationItem, NotificationPage } from "../api/useNotifications";
import { useNotificationsPanelStore } from "../state/useNotificationsPanelStore";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
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
