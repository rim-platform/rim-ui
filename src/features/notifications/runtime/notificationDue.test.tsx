import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, type InfiniteData } from "@tanstack/react-query";

import { queryKeys } from "../../../core/query/keys";
import type { WorkspaceEvent } from "../../../core/events/types";
import type { MessagesPage } from "../../../core/types/messages";
import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";

let subscribeObserver: { next: (result: { data?: { workspaceEvents: string } }) => void } | null =
  null;

vi.mock("../../../core/graphql/wsClient", () => ({
  wsClient: {
    subscribe: vi.fn(
      (
        _request: unknown,
        observer: { next: (result: { data?: { workspaceEvents: string } }) => void },
      ) => {
        subscribeObserver = observer;
        return () => {};
      },
    ),
  },
  onWsConnected: vi.fn(() => () => {}),
}));

vi.mock("../../commands/api/useCommands", () => ({
  useExecuteCommandMutation: () => ({ mutate: vi.fn() }),
}));

vi.mock("../../../shared/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));

vi.mock("@tauri-apps/plugin-notification", () => ({
  sendNotification: vi.fn(),
  isPermissionGranted: vi.fn(() => Promise.resolve(true)),
  requestPermission: vi.fn(() => Promise.resolve("granted")),
}));

const requestMock = vi.fn();
const storeAccountMock = vi.fn((): unknown => null);
const readCachedMessageMock = vi.fn();
vi.mock("../../messages/api/messageCache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../messages/api/messageCache")>()),
  encryptedStoreAccount: () => storeAccountMock(),
  readCachedMessage: (...args: unknown[]) => readCachedMessageMock(...args),
}));
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));

import { sendNotification } from "@tauri-apps/plugin-notification";
import { toast } from "../../../shared/toast";
import { useWorkspaceEvents } from "../../../core/events/useWorkspaceEvents";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { makeConversation } from "../../conversations/__fixtures__/conversations";
import { useNotificationSettingsStore } from "../state/useNotificationSettingsStore";
import { useNotificationEventHandler } from "./useNotificationEventHandler";

const general = makeConversation({ id: "c-general", title: "general" });

function notificationDue(overrides: Partial<Record<string, unknown>> = {}): WorkspaceEvent {
  return {
    type: "NotificationDue",
    workspace_id: "ws-1",
    user_id: "me",
    notification_id: "n-1",
    conversation_id: "c-general",
    message_id: "m-1",
    reason: "mention",
    quiet: false,
    ...overrides,
  } as WorkspaceEvent;
}

function emit(event: WorkspaceEvent) {
  subscribeObserver?.next({ data: { workspaceEvents: JSON.stringify(event) } });
}

function cachedMessages(): InfiniteData<MessagesPage> {
  return {
    pageParams: [null],
    pages: [
      {
        items: [
          {
            id: "m-1",
            serverId: "ws-1",
            conversationId: "c-general",
            threadId: null,
            rootThreadId: null,
            authorId: "u-alice",
            author: { id: "u-alice", username: "alice", displayName: "Alice", avatarUrl: null },
            text: "hello @me",
            hasAttachments: false,
            parentMessageId: null,
            isPinned: false,
            mentionedUserIds: ["me"],
            forwardedFromMessageId: null,
            forwardedFrom: null,
            isDeleted: false,
            sentAt: "2026-10-05T10:00:00Z",
            reactions: [],
            attachments: [],
            linkPreviews: [],
          },
        ],
      } as unknown as MessagesPage,
    ],
  };
}

function setup({ seed = true }: { seed?: boolean } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (seed) {
    qc.setQueryData(queryKeys.joinedChannels("ws-1"), {
      items: [general],
      pageInfo: { hasNext: false, hasPrev: false },
    });
    qc.setQueryData(queryKeys.messages("ws-1", "c-general"), cachedMessages());
  }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  renderHook(
    () => {
      useWorkspaceEvents("ws-1");
      useNotificationEventHandler("ws-1");
    },
    { wrapper },
  );
  return qc;
}

function setDesktop(desktop: boolean) {
  if (desktop) {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  } else {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  }
}

describe("NotificationDue rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestMock.mockReset();
    requestMock.mockReturnValue(new Promise(() => {}));
    storeAccountMock.mockReset().mockReturnValue(null);
    readCachedMessageMock.mockReset();
    subscribeObserver = null;
    setDesktop(true);
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Macintosh)");
    useAuthStore.setState({ session: { userId: "me" } });
    useShellStore.getState().reset();
    useNotificationSettingsStore.setState({ enabled: true, soundEnabled: true, showPreview: true });
  });

  afterEach(() => {
    setDesktop(false);
    vi.restoreAllMocks();
    useAuthStore.setState({ session: null });
  });

  it("shows a desktop notification with sound for a loud event, from the caches", async () => {
    setup();
    emit(notificationDue());

    await waitFor(() =>
      expect(sendNotification).toHaveBeenCalledWith({
        title: "#general",
        body: "Alice: hello @me",
        sound: "Ping",
      }),
    );
    // Everything was cached: no request for the message.
    expect(requestMock).not.toHaveBeenCalledWith(
      expect.stringContaining("NotificationDueContext"),
      expect.anything(),
    );
  });

  it("does not toast or play a sound for a quiet event, but still refreshes the inbox", async () => {
    const qc = setup();
    const spy = vi.spyOn(qc, "invalidateQueries");
    emit(notificationDue({ quiet: true }));

    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.unreadNotificationCount("ws-1") });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["notifications", "ws-1"] });
    await new Promise((r) => setTimeout(r, 0));
    expect(sendNotification).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("respects the device toggles: disabled shows nothing", async () => {
    useNotificationSettingsStore.setState({ enabled: false });
    setup();
    emit(notificationDue());
    await new Promise((r) => setTimeout(r, 0));
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("respects the device toggles: no preview and no sound", async () => {
    useNotificationSettingsStore.setState({ soundEnabled: false, showPreview: false });
    setup();
    emit(notificationDue());
    await waitFor(() =>
      expect(sendNotification).toHaveBeenCalledWith({
        title: "#general",
        body: "New message from Alice",
      }),
    );
  });

  it("loads only what the caches lack, in one request", async () => {
    requestMock.mockImplementation((document: string) =>
      String(document).includes("NotificationDueContext")
        ? Promise.resolve({
            message: {
              id: "m-9",
              authorId: "u-bob",
              author: { id: "u-bob", username: "bob", displayName: null },
              text: "deploy is done",
            },
          })
        : new Promise(() => {}),
    );
    setup();
    emit(notificationDue({ message_id: "m-9", reason: "keyword" }));

    await waitFor(() =>
      expect(sendNotification).toHaveBeenCalledWith({
        title: "#general",
        body: "bob: deploy is done",
        sound: "Ping",
      }),
    );
    const contextCalls = requestMock.mock.calls.filter(([doc]) =>
      String(doc).includes("NotificationDueContext"),
    );
    expect(contextCalls).toHaveLength(1);
    expect(contextCalls[0][1]).toMatchObject({
      serverId: "ws-1",
      conversationId: "c-general",
      messageId: "m-9",
      withConversation: false,
      withMessage: true,
    });
  });

  it("reads an encrypted message's text from this device's store", async () => {
    storeAccountMock.mockReturnValue({ endpoint: "http://localhost:8080/api", userId: "me" });
    readCachedMessageMock.mockImplementation((_account: unknown, id: string) =>
      Promise.resolve(
        id === "m-9" ? { id, text: "the plan", e2ee: { status: "decrypted" } } : null,
      ),
    );
    requestMock.mockImplementation((document: string, vars: { messageId: string }) =>
      String(document).includes("NotificationDueContext")
        ? Promise.resolve({
            message: {
              id: vars.messageId,
              authorId: "u-bob",
              author: { id: "u-bob", username: "bob", displayName: null },
              text: null,
              encryption: { sentAtUs: "1792957000000000" },
            },
          })
        : new Promise(() => {}),
    );
    setup();
    emit(notificationDue({ message_id: "m-9" }));
    await waitFor(() =>
      expect(sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({ body: "bob: the plan" }),
      ),
    );

    emit(notificationDue({ notification_id: "n-2", message_id: "m-10" }));
    await waitFor(() =>
      expect(sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({ body: "bob: Encrypted message" }),
      ),
    );
  });

  it("names a direct message after the other member", async () => {
    const dm = makeConversation({
      id: "c-dm",
      title: null,
      conversationType: ConversationTypeEnum.DIRECT,
      memberIds: ["me", "u-alice"],
    });
    const qc = setup();
    qc.setQueryData(queryKeys.conversations("ws-1"), {
      items: [dm],
      pageInfo: { hasNext: false, hasPrev: false },
    });
    qc.setQueryData(queryKeys.serverMembers("ws-1"), [
      { userId: "u-alice", username: "alice", displayName: "Alice" },
    ]);
    qc.setQueryData(queryKeys.messages("ws-1", "c-dm"), {
      pageParams: [null],
      pages: [{ items: [{ id: "m-2", authorId: "u-alice", author: null, text: "hi" }] }],
    });
    emit(notificationDue({ conversation_id: "c-dm", message_id: "m-2", reason: "direct" }));

    await waitFor(() =>
      expect(sendNotification).toHaveBeenCalledWith({
        title: "Alice",
        body: "Alice: hi",
        sound: "Ping",
      }),
    );
  });

  it("falls back to an in-app toast outside the desktop app", async () => {
    setDesktop(false);
    setup();
    emit(notificationDue());
    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith("#general", { description: "Alice: hello @me" }),
    );
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("no longer notifies on NewMessage or UserMentioned by itself", async () => {
    setup();
    emit({
      type: "NewMessage",
      workspace_id: "ws-1",
      conversation_id: "c-general",
      message: {
        id: "m-3",
        server_id: "ws-1",
        conversation_id: "c-general",
        thread_id: null,
        root_thread_id: null,
        author_id: "u-alice",
        text: "plain message",
        has_attachments: false,
        parent_message_id: null,
        forwarded_from_message_id: null,
        is_deleted: false,
        sent_at: "2026-10-05T10:01:00Z",
        reactions: [],
      },
    });
    emit({
      type: "UserMentioned",
      workspace_id: "ws-1",
      conversation_id: "c-general",
      message_id: "m-3",
      mentioned_by: "u-alice",
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(sendNotification).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });
});

describe("notification cache hygiene on realtime events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestMock.mockReset();
    requestMock.mockReturnValue(new Promise(() => {}));
    useAuthStore.setState({ session: { userId: "me" } });
    useShellStore.getState().reset();
  });

  afterEach(() => {
    useAuthStore.setState({ session: null });
  });

  it("a read-state update refetches the unread count", () => {
    const qc = setup();
    const spy = vi.spyOn(qc, "invalidateQueries");
    emit({
      type: "ReadStateUpdated",
      workspace_id: "ws-1",
      conversation_id: "c-general",
      user_id: "me",
      last_read_at: "2026-10-05T10:00:00Z",
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.unreadNotificationCount("ws-1") });
  });

  it("the viewer's removal from a conversation refetches the count and the inbox", () => {
    const qc = setup();
    const spy = vi.spyOn(qc, "invalidateQueries");
    emit({
      type: "MemberRemovedFromConversation",
      workspace_id: "ws-1",
      conversation_id: "c-general",
      user_id: "me",
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.unreadNotificationCount("ws-1") });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["notifications", "ws-1"] });
  });

  it("someone else's removal leaves the inbox alone", () => {
    const qc = setup();
    const spy = vi.spyOn(qc, "invalidateQueries");
    emit({
      type: "MemberRemovedFromConversation",
      workspace_id: "ws-1",
      conversation_id: "c-general",
      user_id: "u-bob",
    });
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ["notifications", "ws-1"] });
  });

  it("the viewer leaving the workspace refetches the count and the inbox", () => {
    const qc = setup();
    const spy = vi.spyOn(qc, "invalidateQueries");
    emit({ type: "MemberLeft", workspace_id: "ws-1", user_id: "me" });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.unreadNotificationCount("ws-1") });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["notifications", "ws-1"] });
  });
});
