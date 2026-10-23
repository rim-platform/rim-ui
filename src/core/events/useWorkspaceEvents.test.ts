import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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

import { toast } from "../../shared/toast";
import { logger } from "../logger";
import { useShellStore } from "../../shell/state/useShellStore";
import { useAuthStore } from "../../features/auth/state/useAuthStore";
import { useMembersPanelStore } from "../../features/conversations/state/useMembersPanelStore";
import { markLeaving, clearLeaving } from "../../features/conversations/state/pendingLeaves";
import { makeConversation } from "../../features/conversations/__fixtures__/conversations";
import type { ConversationSummaryPage } from "../../features/conversations/types";
import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";
import { useMemberDirectoryStore } from "../../features/workspaces/state/useMemberDirectoryStore";
import { ServerMemberRoleGql } from "../graphql/generated/schema-types";
import { SUBSCRIPTION_LIMIT_TOAST_ID } from "../graphql/subscriptionErrors";
import { useContactStore } from "../../features/relay/contacts/useContactStore";
import { eventBus } from "./eventBus";
import { BUS_EVENTS, type TypingStartedEvent, type TypingStoppedEvent } from "./busEvents";
import { useWorkspaceEvents } from "./useWorkspaceEvents";

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
    connectedHandler?.();

    expect(spy).not.toHaveBeenCalled();
  });

  it("invalidates every volatile workspace root on reconnect, scoped to the active workspace", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");

    renderHook(() => useWorkspaceEvents("ws-1"), { wrapper: wrapperFor(qc) });
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
