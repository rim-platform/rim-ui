import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  removalAccountKey,
  useRemovalNotices,
} from "../../features/workspaces/state/useRemovalNotices";
import { queryKeys, VOLATILE_WORKSPACE_KEY_ROOTS } from "../query/keys";
import type { MessageEventData, WorkspaceEvent } from "./types";

let connectedHandler: (() => void) | null = null;
interface Observer {
  next: (result: { data?: { workspaceEvents: string } }) => void;
  error: (err: unknown) => void;
}

let subscribeObserver: Observer | null = null;

vi.mock("../graphql/wsClient", () => ({
  wsClient: {
    subscribe: vi.fn((_request: unknown, observer: Observer) => {
      subscribeObserver = observer;
      return () => {};
    }),
  },
  onWsConnected: vi.fn((handler: () => void) => {
    connectedHandler = handler;
    return () => {
      connectedHandler = null;
    };
  }),
}));

vi.mock("../../shared/toast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  },
}));

const platform = vi.hoisted(() => ({ value: "web" as "web" | "desktop" }));
vi.mock("../runtime/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../runtime/runtime")>()),
  detectPlatform: () => platform.value,
}));
const notifications = vi.hoisted(() => ({
  desktop: vi.fn(() => Promise.resolve()),
  browser: vi.fn(() => false),
}));
vi.mock("../../features/notifications/runtime/desktopNotification", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../features/notifications/runtime/desktopNotification")
  >()),
  showDesktopNotification: notifications.desktop,
}));
vi.mock("../../features/notifications/runtime/browserNotification", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../features/notifications/runtime/browserNotification")
  >()),
  showBrowserTextNotification: notifications.browser,
}));

import { toast } from "../../shared/toast";
import { logger } from "../logger";
import { useShellStore } from "../../shell/state/useShellStore";
import { useAuthStore } from "../../features/auth/state/useAuthStore";
import { useMembersPanelStore } from "../../features/conversations/state/useMembersPanelStore";
import { markLeaving, clearLeaving } from "../../features/conversations/state/pendingLeaves";
import { makeConversation } from "../../features/conversations/__fixtures__/conversations";
import type { ConversationSummaryPage } from "../../features/conversations/types";
import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";
import { expectDeparture } from "../../features/workspaces/state/memberEvents";
import { useMemberDirectoryStore } from "../../features/workspaces/state/useMemberDirectoryStore";
import { ConversationTypeEnum, ServerMemberRoleGql } from "../graphql/generated/schema-types";
import { SUBSCRIPTION_LIMIT_TOAST_ID } from "../graphql/subscriptionErrors";
import { useContactStore } from "../../features/relay/contacts/useContactStore";
import { eventBus } from "./eventBus";
import { BUS_EVENTS, type TypingStartedEvent, type TypingStoppedEvent } from "./busEvents";
import { applyWorkspaceEvent, useWorkspaceEvents } from "./useWorkspaceEvents";
import { JoinRequestStatus } from "../graphql/generated/schema-types";
import { useNotificationSettingsStore } from "../../features/notifications/state/useNotificationSettingsStore";
import { DIRECT_SPACE_ID } from "../../test/directSpace";
import type { JoinRequestRow } from "../../features/workspaces/api/publicJoinLink";

/** Simulates the backend pushing a `WorkspaceEvent` down the subscription. */
function emitWorkspaceEvent(event: WorkspaceEvent) {
  subscribeObserver?.next({ data: { workspaceEvents: JSON.stringify(event) } });
}

/** The encryption block of an encrypted message event. */
const ENCRYPTION: MessageEventData["encryption"] = {
  incarnation: 1,
  epoch: 2,
  sender_device_id: "d-2",
  ciphertext: "AAEC",
  franking_receipt: "cmVjZWlwdA",
  franking_key_id: 1,
  sent_at_us: "1791504000123456",
};

/** A `NewMessage` from u-2 in `conversationId` of ws-1, encrypted when `encryption` is given. */
function newMessage(
  conversationId: string,
  encryption: MessageEventData["encryption"] = null,
): WorkspaceEvent {
  return {
    type: "NewMessage",
    workspace_id: "ws-1",
    conversation_id: conversationId,
    message: {
      id: "m-1",
      server_id: "ws-1",
      conversation_id: conversationId,
      thread_id: null,
      root_thread_id: null,
      author_id: "u-2",
      text: encryption ? null : "hi",
      has_attachments: false,
      parent_message_id: null,
      forwarded_from_message_id: null,
      is_deleted: false,
      sent_at: "2026-10-09T10:00:00Z",
      reactions: [],
      encryption,
    },
  };
}

function wrapperFor(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

describe("useWorkspaceEvents reconnect invalidation", () => {
  beforeEach(() => {
    connectedHandler = null;
    subscribeObserver = null;
    vi.clearAllMocks();
  });

  it("does not invalidate anything on the first (initial) connect", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");

    renderHook(() => useWorkspaceEvents("ws-1"), { wrapper: wrapperFor(qc) });
    spy.mockClear(); // the refetch at subscription start
    connectedHandler?.();

    expect(spy).not.toHaveBeenCalled();
  });

  it("invalidates every volatile workspace root on reconnect, scoped to the active workspace", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");

    renderHook(() => useWorkspaceEvents("ws-1"), { wrapper: wrapperFor(qc) });
    spy.mockClear(); // the refetch at subscription start
    connectedHandler?.(); // initial connect — skipped
    connectedHandler?.(); // reconnect

    for (const root of VOLATILE_WORKSPACE_KEY_ROOTS) {
      expect(spy).toHaveBeenCalledWith({ queryKey: [root, "ws-1"] });
    }
    expect(spy).toHaveBeenCalledTimes(VOLATILE_WORKSPACE_KEY_ROOTS.length);
    // Never a blanket, unfiltered invalidation.
    for (const call of spy.mock.calls) {
      expect(call[0]).toBeDefined();
      expect(Array.isArray((call[0] as { queryKey?: unknown }).queryKey)).toBe(true);
    }
  });

  it("invalidates nothing on reconnect when there is no active workspace", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");

    renderHook(() => useWorkspaceEvents(null), { wrapper: wrapperFor(qc) });
    connectedHandler?.(); // initial connect — skipped
    connectedHandler?.(); // reconnect, but no workspace to scope to

    expect(spy).not.toHaveBeenCalled();
  });
});

describe("useWorkspaceEvents unknown events", () => {
  beforeEach(() => {
    connectedHandler = null;
    subscribeObserver = null;
    vi.clearAllMocks();
  });

  it("an unrecognized event shape is a silent no-op (defensive JSON.parse + switch, no throw)", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");

    renderHook(() => useWorkspaceEvents("ws-1"), { wrapper: wrapperFor(qc) });
    spy.mockClear(); // the refetch at subscription start

    expect(() =>
      subscribeObserver?.next({
        data: { workspaceEvents: JSON.stringify({ type: "SomeFutureEventType", foo: "bar" }) },
      }),
    ).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("useWorkspaceEvents subscription limit", () => {
  beforeEach(() => {
    connectedHandler = null;
    subscribeObserver = null;
    vi.clearAllMocks();
  });

  it("shows a TOO_MANY_SUBSCRIPTIONS refusal as a notice and does not subscribe again", async () => {
    const { wsClient } = await import("../graphql/wsClient");
    const qc = new QueryClient();
    renderHook(() => useWorkspaceEvents("ws-1"), { wrapper: wrapperFor(qc) });

    subscribeObserver?.error([
      {
        message: "too many subscriptions",
        extensions: { code: "TOO_MANY_SUBSCRIPTIONS", limit: 1 },
      },
    ]);

    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith(
      "Some live updates are off",
      expect.objectContaining({ id: SUBSCRIPTION_LIMIT_TOAST_ID }),
    );
    expect(toast.error).not.toHaveBeenCalled();
    expect(wsClient.subscribe).toHaveBeenCalledTimes(1);
  });

  it("ends quietly when the server closed the connection because the session ended", async () => {
    const { wsClient } = await import("../graphql/wsClient");
    const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const qc = new QueryClient();
    renderHook(() => useWorkspaceEvents("ws-1"), { wrapper: wrapperFor(qc) });

    subscribeObserver?.error(new CloseEvent("close", { code: 4401 }));

    expect(error).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
    expect(wsClient.subscribe).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});

describe("useWorkspaceEvents conversation membership and archive", () => {
  const secret = makeConversation({ id: "c-secret", title: "secret", isPrivate: true });
  const general = makeConversation({ id: "c-general", title: "general" });

  function pageOf(...items: ReturnType<typeof makeConversation>[]): ConversationSummaryPage {
    return { items, pageInfo: { hasNext: false, hasPrev: false } };
  }

  function setup() {
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.joinedChannels("ws-1"), pageOf(general, secret));
    qc.setQueryData(queryKeys.conversations("ws-1"), pageOf());
    const spy = vi.spyOn(qc, "invalidateQueries");
    renderHook(() => useWorkspaceEvents("ws-1"), { wrapper: wrapperFor(qc) });
    return { qc, spy };
  }

  function joinedIds(qc: QueryClient) {
    return qc
      .getQueryData<ConversationSummaryPage>(queryKeys.joinedChannels("ws-1"))
      ?.items.map((c) => c.id);
  }

  beforeEach(() => {
    connectedHandler = null;
    subscribeObserver = null;
    vi.clearAllMocks();
    useShellStore.getState().reset();
    useAuthStore.setState({ session: { userId: "me" } });
    useMembersPanelStore.setState({ open: false });
  });

  afterEach(() => {
    useAuthStore.setState({ session: null });
    useShellStore.getState().reset();
  });

  it("removal of the viewer drops the conversation and leaves it when open, with a toast", () => {
    const { qc } = setup();
    useShellStore.setState({ selectedConversationId: "c-secret" });
    useMembersPanelStore.setState({ open: true });

    emitWorkspaceEvent({
      type: "MemberRemovedFromConversation",
      workspace_id: "ws-1",
      conversation_id: "c-secret",
      user_id: "me",
    });

    expect(joinedIds(qc)).toEqual(["c-general"]);
    expect(useShellStore.getState().selectedConversationId).toBeNull();
    expect(useMembersPanelStore.getState().open).toBe(false);
    expect(toast.info).toHaveBeenCalledWith("You are no longer a member of #secret");
  });

  it("removal of the viewer from a conversation that is not open only drops it", () => {
    const { qc } = setup();
    useShellStore.setState({ selectedConversationId: "c-general" });

    emitWorkspaceEvent({
      type: "MemberRemovedFromConversation",
      workspace_id: "ws-1",
      conversation_id: "c-secret",
      user_id: "me",
    });

    expect(joinedIds(qc)).toEqual(["c-general"]);
    expect(useShellStore.getState().selectedConversationId).toBe("c-general");
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("a voluntary leave does not also show the removal toast", () => {
    setup();
    useShellStore.setState({ selectedConversationId: "c-secret" });
    markLeaving("c-secret");
    try {
      emitWorkspaceEvent({
        type: "MemberRemovedFromConversation",
        workspace_id: "ws-1",
        conversation_id: "c-secret",
        user_id: "me",
      });
    } finally {
      clearLeaving("c-secret");
    }
    expect(useShellStore.getState().selectedConversationId).toBeNull();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("removal of someone else refreshes the members and lists but keeps the conversation", () => {
    const { qc, spy } = setup();
    useShellStore.setState({ selectedConversationId: "c-secret" });

    emitWorkspaceEvent({
      type: "MemberRemovedFromConversation",
      workspace_id: "ws-1",
      conversation_id: "c-secret",
      user_id: "u-alice",
    });

    expect(joinedIds(qc)).toEqual(["c-general", "c-secret"]);
    expect(useShellStore.getState().selectedConversationId).toBe("c-secret");
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.conversation("ws-1", "c-secret") });
  });

  it("the viewer being added refetches the joined channel list", () => {
    const { spy } = setup();
    emitWorkspaceEvent({
      type: "MemberAddedToConversation",
      workspace_id: "ws-1",
      conversation_id: "c-new",
      user_id: "me",
    });
    // The `channels` prefix covers the joined list.
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.channels("ws-1") });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.conversations("ws-1") });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.conversation("ws-1", "c-new") });
  });

  it("ConversationUpdated refetches the conversation and the channel lists", () => {
    const { spy } = setup();
    emitWorkspaceEvent({
      type: "ConversationUpdated",
      workspace_id: "ws-1",
      conversation_id: "c-general",
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.conversation("ws-1", "c-general") });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.channels("ws-1") });
  });

  it("MemberJoined refetches the channel lists and the public channels, not a private channel or a DM", () => {
    const { qc } = setup();
    const direct = makeConversation({
      id: "c-dm",
      conversationType: ConversationTypeEnum.DIRECT,
      isPrivate: true,
    });
    qc.setQueryData(queryKeys.conversation("ws-1", "c-general"), general);
    qc.setQueryData(queryKeys.conversation("ws-1", "c-secret"), secret);
    qc.setQueryData(queryKeys.conversation("ws-1", "c-dm"), direct);

    emitWorkspaceEvent({
      type: "MemberJoined",
      workspace_id: "ws-1",
      user_id: "u-new",
      username: "new",
    });

    const invalidated = (key: readonly unknown[]) => qc.getQueryState(key)?.isInvalidated;
    expect(invalidated(queryKeys.joinedChannels("ws-1"))).toBe(true);
    expect(invalidated(queryKeys.conversation("ws-1", "c-general"))).toBe(true);
    expect(invalidated(queryKeys.conversation("ws-1", "c-secret"))).toBe(false);
    expect(invalidated(queryKeys.conversation("ws-1", "c-dm"))).toBe(false);
  });
});

describe("useWorkspaceEvents workspace roles and removal", () => {
  function setup() {
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.server("ws-1"), {
      id: "ws-1",
      name: "Acme",
      viewerRole: ServerMemberRoleGql.MEMBER,
    });
    qc.setQueryData(queryKeys.myServers(), [
      { id: "ws-1", name: "Acme" },
      { id: "ws-2", name: "Beta" },
    ]);
    const spy = vi.spyOn(qc, "invalidateQueries");
    renderHook(() => useWorkspaceEvents("ws-1"), { wrapper: wrapperFor(qc) });
    return { qc, spy };
  }

  beforeEach(() => {
    connectedHandler = null;
    subscribeObserver = null;
    vi.clearAllMocks();
    useShellStore.getState().reset();
    useAuthStore.setState({ session: { userId: "me" } });
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useMembersPanelStore.setState({ open: false });
    useMemberDirectoryStore.setState({ open: false });
  });

  afterEach(() => {
    useAuthStore.setState({ session: null });
    useWorkspaceStore.setState({ workspaceId: null });
    useShellStore.getState().reset();
  });

  it("MemberRoleChanged for someone else refetches the member directory only", () => {
    const { qc, spy } = setup();
    emitWorkspaceEvent({
      type: "MemberRoleChanged",
      workspace_id: "ws-1",
      user_id: "u-alice",
      role: "moderator",
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.serverMembers("ws-1") });
    expect(spy).not.toHaveBeenCalledWith({ queryKey: queryKeys.server("ws-1") });
    expect(qc.getQueryData<{ viewerRole: string }>(queryKeys.server("ws-1"))?.viewerRole).toBe(
      ServerMemberRoleGql.MEMBER,
    );
  });

  it("MemberRoleChanged for the viewer patches and refetches their role and role-shaped lists", () => {
    const { qc, spy } = setup();
    emitWorkspaceEvent({
      type: "MemberRoleChanged",
      workspace_id: "ws-1",
      user_id: "me",
      role: "guest",
    });
    // The guest UI re-evaluates at once from the patched cache.
    expect(qc.getQueryData<{ viewerRole: string }>(queryKeys.server("ws-1"))?.viewerRole).toBe(
      ServerMemberRoleGql.GUEST,
    );
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.serverMembers("ws-1") });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.server("ws-1") });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.channels("ws-1") });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.conversations("ws-1") });
  });

  it("MemberLeft for someone else refetches the member directory and stays put", () => {
    const { spy } = setup();
    emitWorkspaceEvent({ type: "MemberLeft", workspace_id: "ws-1", user_id: "u-alice" });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.serverMembers("ws-1") });
    expect(useWorkspaceStore.getState().workspaceId).toBe("ws-1");
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("keeps a ban explanation for the removed account after leaving", () => {
    useRemovalNotices.setState({ accounts: {} });
    setup();
    emitWorkspaceEvent({
      type: "MemberLeft",
      workspace_id: "ws-1",
      user_id: "me",
      cause: "ban",
      reason: "Repeated spam",
    });
    expect(useRemovalNotices.getState().accounts[removalAccountKey("me")]).toEqual([
      expect.objectContaining({ workspaceName: "Acme", cause: "ban", reason: "Repeated spam" }),
    ]);
    expect(toast.info).toHaveBeenCalledWith("You were banned from Acme");
  });

  it("does not save another person's removal reason", () => {
    useRemovalNotices.setState({ accounts: {} });
    setup();
    emitWorkspaceEvent({
      type: "MemberLeft",
      workspace_id: "ws-1",
      user_id: "u-alice",
      cause: "ban",
      reason: "private",
    });
    expect(useRemovalNotices.getState().accounts).toEqual({});
  });

  it("MemberLeft for the viewer leaves the workspace with a toast and refetches myServers", () => {
    useShellStore.setState({ selectedConversationId: "c-general" });
    useMembersPanelStore.setState({ open: true });
    useMemberDirectoryStore.setState({ open: true });
    const { qc, spy } = setup();
    emitWorkspaceEvent({ type: "MemberLeft", workspace_id: "ws-1", user_id: "me" });

    expect(useWorkspaceStore.getState().workspaceId).toBeNull();
    expect(useShellStore.getState().selectedConversationId).toBeNull();
    expect(useMembersPanelStore.getState().open).toBe(false);
    expect(useMemberDirectoryStore.getState().open).toBe(false);
    expect(qc.getQueryData<{ id: string }[]>(queryKeys.myServers())?.map((s) => s.id)).toEqual([
      "ws-2",
    ]);
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.myServers() });
    expect(toast.info).toHaveBeenCalledWith("You were removed from Acme");
  });

  it("WorkspaceUpdated renames the workspace in the rail and its query", () => {
    const { qc } = setup();
    emitWorkspaceEvent({ type: "WorkspaceUpdated", workspace_id: "ws-1", name: "Acme Two" });

    expect(qc.getQueryData<{ id: string; name: string }[]>(queryKeys.myServers())).toEqual([
      { id: "ws-1", name: "Acme Two" },
      { id: "ws-2", name: "Beta" },
    ]);
    expect(qc.getQueryData<{ name: string }>(queryKeys.server("ws-1"))?.name).toBe("Acme Two");
  });

  it('MemberLeft with cause left for the viewer leaves with "You left Acme"', () => {
    const { qc } = setup();
    emitWorkspaceEvent({
      type: "MemberLeft",
      workspace_id: "ws-1",
      user_id: "me",
      cause: "left",
    });

    expect(useWorkspaceStore.getState().workspaceId).toBeNull();
    expect(qc.getQueryData<{ id: string }[]>(queryKeys.myServers())?.map((s) => s.id)).toEqual([
      "ws-2",
    ]);
    expect(toast.info).toHaveBeenCalledWith("You left Acme");
  });

  it("MemberLeft with cause left shows no toast when this client is leaving it", () => {
    setup();
    expectDeparture("ws-1");
    emitWorkspaceEvent({
      type: "MemberLeft",
      workspace_id: "ws-1",
      user_id: "me",
      cause: "left",
    });

    expect(useWorkspaceStore.getState().workspaceId).toBeNull();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("subscribing to a workspace refetches the workspace list", () => {
    const { spy } = setup();
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.myServers() });
  });
});

describe("useWorkspaceEvents encrypted conversations", () => {
  beforeEach(() => {
    subscribeObserver = null;
    vi.clearAllMocks();
  });

  it("does not put an encrypted message's empty text into the timeline", () => {
    const qc = new QueryClient();
    const key = queryKeys.messages("ws-1", "c-enc");
    qc.setQueryData(key, {
      pages: [{ items: [], next: null, prev: null, pageInfo: { hasNext: false, hasPrev: false } }],
      pageParams: [null],
    });
    renderHook(() => useWorkspaceEvents("ws-1"), { wrapper: wrapperFor(qc) });

    emitWorkspaceEvent(newMessage("c-enc", ENCRYPTION));

    const data = qc.getQueryData<{ pages: { items: unknown[] }[] }>(key);
    expect(data?.pages[0].items).toEqual([]);
  });
});

describe("useWorkspaceEvents message edits", () => {
  const key = queryKeys.messages("ws-1", "c-1");

  /** A client holding c-1's timeline with m-1, edited at `editedAt` as far as it knows. */
  function timelineWith(editedAt?: string | null): QueryClient {
    const qc = new QueryClient();
    qc.setQueryData(key, {
      pages: [
        {
          items: [{ id: "m-1", text: "hi", isDeleted: false, sentAt: "x", editedAt }],
          next: null,
          prev: null,
          pageInfo: { hasNext: false, hasPrev: false },
        },
      ],
      pageParams: [null],
    });
    return qc;
  }

  /** The `MessageUpdated` for m-1 with the text "hi again" and `edited_at` when given. */
  function edited(editedAt?: string | null): WorkspaceEvent {
    const event = newMessage("c-1");
    if (event.type !== "NewMessage") throw new Error("not a NewMessage");
    const message = { ...event.message, text: "hi again" };
    if (editedAt !== undefined) message.edited_at = editedAt;
    return { type: "MessageUpdated", workspace_id: "ws-1", conversation_id: "c-1", message };
  }

  function cached(qc: QueryClient) {
    return qc.getQueryData<{ pages: { items: Record<string, unknown>[] }[] }>(key)?.pages[0]
      .items[0];
  }

  it("MessageUpdated sets editedAt on the cached message", () => {
    const qc = timelineWith(null);
    applyWorkspaceEvent(edited("2026-10-27T12:00:00Z"), qc, "ws-1");
    expect(cached(qc)).toMatchObject({ text: "hi again", editedAt: "2026-10-27T12:00:00Z" });
  });

  it("keeps the cached editedAt when the event has none", () => {
    const qc = timelineWith("2026-10-27T11:00:00Z");
    applyWorkspaceEvent(edited(), qc, "ws-1");
    expect(cached(qc)).toMatchObject({ text: "hi again", editedAt: "2026-10-27T11:00:00Z" });
  });
});

describe("useWorkspaceEvents thread reply counts", () => {
  beforeEach(() => {
    subscribeObserver = null;
    vi.clearAllMocks();
  });

  /** A `NewMessage` that replies in thread t-1 of c-1. */
  function threadReply(encryption: MessageEventData["encryption"] = null): WorkspaceEvent {
    const event = newMessage("c-1", encryption);
    if (event.type !== "NewMessage") throw new Error("not a NewMessage");
    return { ...event, message: { ...event.message, thread_id: "t-1" } };
  }

  it("refetches reply counts when a thread reply arrives or is deleted", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    renderHook(() => useWorkspaceEvents("ws-1"), { wrapper: wrapperFor(qc) });
    const counts = { queryKey: ["threadReplyCount", "ws-1", "c-1"] };

    emitWorkspaceEvent(threadReply());
    expect(spy).toHaveBeenCalledWith(counts);

    spy.mockClear();
    emitWorkspaceEvent(threadReply(ENCRYPTION));
    expect(spy).toHaveBeenCalledWith(counts);

    spy.mockClear();
    emitWorkspaceEvent({
      type: "MessageDeleted",
      workspace_id: "ws-1",
      conversation_id: "c-1",
      message_id: "m-1",
      thread_id: "t-1",
    });
    expect(spy).toHaveBeenCalledWith(counts);
  });

  it("leaves reply counts alone for a timeline message", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    renderHook(() => useWorkspaceEvents("ws-1"), { wrapper: wrapperFor(qc) });

    emitWorkspaceEvent(newMessage("c-1"));
    emitWorkspaceEvent(newMessage("c-1", ENCRYPTION));

    expect(spy).not.toHaveBeenCalledWith({ queryKey: ["threadReplyCount", "ws-1", "c-1"] });
  });
});

describe("useWorkspaceEvents typing", () => {
  const BOB = { userId: "u-2", username: "bob", displayName: "Bob B", principalId: "rimp1_bob" };

  beforeEach(() => {
    subscribeObserver = null;
    vi.clearAllMocks();
    useContactStore.setState({ aliases: {} });
  });

  /** The name the typing indicator is handed for `event`, with `members` cached for ws-1. */
  function typingNameFor(
    event: Partial<Extract<WorkspaceEvent, { type: "TypingStarted" }>>,
    members?: (typeof BOB)[],
  ): string | undefined {
    const qc = new QueryClient();
    if (members) qc.setQueryData(queryKeys.serverMembers("ws-1"), members);
    let shown: string | undefined;
    const off = eventBus.on<TypingStartedEvent>(BUS_EVENTS.TYPING_STARTED, (e) => {
      shown = e.username;
    });
    renderHook(() => useWorkspaceEvents("ws-1"), { wrapper: wrapperFor(qc) });
    emitWorkspaceEvent({
      type: "TypingStarted",
      workspace_id: "ws-1",
      conversation_id: "c-1",
      user_id: "u-2",
      ...event,
    });
    off();
    return shown;
  }

  it("names the typist by the event's display name, else its username", () => {
    expect(typingNameFor({ username: "bob", display_name: "Bobby" }, [BOB])).toBe("Bobby");
    expect(typingNameFor({ username: "bob", display_name: null }, [BOB])).toBe("bob");
  });

  it("names the typist from the cached members when the event carries no name", () => {
    expect(typingNameFor({}, [BOB])).toBe("Bob B");
    expect(typingNameFor({}, [{ ...BOB, displayName: "" }])).toBe("bob");
  });

  it("says Someone when neither the event nor the caches name the typist", () => {
    expect(typingNameFor({})).toBe("Someone");
  });

  it("prefers the name this person gave the typist as a contact", () => {
    useContactStore.setState({ aliases: { rimp1_bob: "My Bob" } });
    expect(typingNameFor({ username: "bob", display_name: "Bobby" }, [BOB])).toBe("My Bob");
  });

  it("a message ends its author's typing in that conversation, encrypted or not", () => {
    const stopped: TypingStoppedEvent[] = [];
    const off = eventBus.on<TypingStoppedEvent>(BUS_EVENTS.TYPING_STOPPED, (e) => {
      stopped.push(e);
    });
    renderHook(() => useWorkspaceEvents("ws-1"), { wrapper: wrapperFor(new QueryClient()) });

    emitWorkspaceEvent(newMessage("c-1"));
    emitWorkspaceEvent(newMessage("c-enc", ENCRYPTION));
    off();

    expect(stopped).toEqual([
      { conversationId: "c-1", userId: "u-2" },
      { conversationId: "c-enc", userId: "u-2" },
    ]);
  });
});

describe("join request events", () => {
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

  /** A client that knows the viewer's open request, and spies on what it refreshes. */
  function listen(spaceId: string, withRequest = true) {
    const qc = new QueryClient();
    if (withRequest) qc.setQueryData(queryKeys.myJoinRequests(), [mine]);
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    renderHook(() => useWorkspaceEvents(spaceId), { wrapper: wrapperFor(qc) });
    // Only what the events cause, not the refetch at subscription start.
    invalidate.mockClear();
    return { qc, invalidate };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    platform.value = "web";
    notifications.browser.mockReturnValue(false);
    useAuthStore.setState({ session: { userId: ME } });
    useNotificationSettingsStore.setState({ enabled: true, soundEnabled: true });
  });

  afterEach(() => useAuthStore.setState({ session: null }));

  it.each([
    ["the workspace's own subscription", "ws-acme"],
    ["the direct-space subscription", DIRECT_SPACE_ID],
  ])("refreshes the asked workspace's requests and link on %s", async (_name, spaceId) => {
    const { invalidate } = listen(spaceId);

    emitWorkspaceEvent({
      type: "JoinRequestCreated",
      workspace_id: "ws-acme",
      request_id: "jr-2",
      user_id: "u-other",
    });
    emitWorkspaceEvent(decided("declined", "u-other"));

    await waitFor(() =>
      expect(
        invalidate.mock.calls.filter(
          ([filters]) =>
            JSON.stringify(filters) ===
            JSON.stringify({ queryKey: queryKeys.joinRequests("ws-acme") }),
        ),
      ).toHaveLength(2),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.publicJoinLink("ws-acme") });
    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: queryKeys.joinRequests(DIRECT_SPACE_ID),
    });
    // Someone else's request tells the viewer nothing.
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: queryKeys.myServers() });
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("tells the person on the direct space that their request was accepted", async () => {
    const { invalidate } = listen(DIRECT_SPACE_ID);

    emitWorkspaceEvent(decided("accepted"));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Your request to join Acme Community was accepted.",
        { description: "The workspace is in your workspace list now." },
      ),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.myServers() });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.myJoinRequests() });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["publicJoinLinkPreview"] });
  });

  it("tells the person that their request was declined, without refreshing their workspaces", async () => {
    const { invalidate } = listen(DIRECT_SPACE_ID);

    emitWorkspaceEvent(decided("declined"));

    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith("Your request to join Acme Community was declined.", {
        description: "You can ask to join it again in 24 hours.",
      }),
    );
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: queryKeys.myServers() });
  });

  it("shows a browser notification where the site may, instead of a toast", async () => {
    notifications.browser.mockReturnValue(true);
    listen(DIRECT_SPACE_ID);

    emitWorkspaceEvent(decided("declined"));

    await waitFor(() =>
      expect(notifications.browser).toHaveBeenCalledWith(
        "Your request to join Acme Community was declined.",
        "You can ask to join it again in 24 hours.",
      ),
    );
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("shows a desktop notification in the desktop app, with the device's sound setting", async () => {
    platform.value = "desktop";
    useNotificationSettingsStore.setState({ soundEnabled: false });
    listen(DIRECT_SPACE_ID);

    emitWorkspaceEvent(decided("accepted"));

    await waitFor(() =>
      expect(notifications.desktop).toHaveBeenCalledWith({
        title: "Your request to join Acme Community was accepted.",
        body: "The workspace is in your workspace list now.",
        sound: false,
      }),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("follows the device's notification switch", async () => {
    useNotificationSettingsStore.setState({ enabled: false });
    const { invalidate } = listen(DIRECT_SPACE_ID);

    emitWorkspaceEvent(decided("accepted"));

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.myServers() }),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(notifications.browser).not.toHaveBeenCalled();
  });

  it.each(["withdrawn", "cancelled"])("says nothing when a request is %s", async (outcome) => {
    const { invalidate } = listen(DIRECT_SPACE_ID);

    emitWorkspaceEvent(decided(outcome));

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.myJoinRequests() }),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
    expect(notifications.browser).not.toHaveBeenCalled();
    expect(notifications.desktop).not.toHaveBeenCalled();
  });

  it("names a workspace it does not know as a workspace", async () => {
    listen(DIRECT_SPACE_ID, false);
    emitWorkspaceEvent(decided("declined"));
    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith(
        "Your request to join a workspace was declined.",
        expect.anything(),
      ),
    );
  });

  it("refreshes the Owner's link statistics on a join through the public link only", async () => {
    const { invalidate } = listen("ws-acme", false);

    emitWorkspaceEvent({
      type: "MemberJoined",
      workspace_id: "ws-acme",
      user_id: "u-new",
      username: "new",
      source: "public_link",
    });
    emitWorkspaceEvent({
      type: "MemberJoined",
      workspace_id: "ws-acme",
      user_id: "u-inv",
      username: "inv",
    });

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.serverMembers("ws-acme") }),
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

describe("pipeline firings", () => {
  const fired = (actionsExecuted: number): WorkspaceEvent => ({
    type: "PipelineFired",
    workspace_id: "ws-1",
    pipeline_id: "p-1",
    pipeline_name: "Deploy failed",
    trigger_event: "NewMessage",
    actions_executed: actionsExecuted,
  });

  /** A query client holding pipeline p-1 of ws-1 with `actionCount` actions. */
  function withPipeline(actionCount: number): QueryClient {
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.pipelines("ws-1"), [
      {
        id: "p-1",
        name: "Deploy failed",
        actions: Array.from({ length: actionCount }, () => ({
          actionType: "COMMAND",
          commandId: "chat.search_messages",
          args: null,
        })),
      },
    ]);
    return qc;
  }

  beforeEach(() => {
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.warning).mockClear();
  });

  it("says how many of the pipeline's actions ran, as a warning when some did not", () => {
    applyWorkspaceEvent(fired(1), withPipeline(2), "ws-1");

    expect(toast.warning).toHaveBeenCalledWith('Pipeline "Deploy failed" fired', {
      description: "1 of 2 actions ran after a new message",
    });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("is a success when every action ran", () => {
    applyWorkspaceEvent(fired(2), withPipeline(2), "ws-1");

    expect(toast.success).toHaveBeenCalledWith('Pipeline "Deploy failed" fired', {
      description: "2 of 2 actions ran after a new message",
    });
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("counts only what ran when the pipeline is not cached", () => {
    applyWorkspaceEvent(fired(1), new QueryClient(), "ws-1");

    expect(toast.success).toHaveBeenCalledWith('Pipeline "Deploy failed" fired', {
      description: "1 action ran after a new message",
    });
  });
});
