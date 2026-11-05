import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, type InfiniteData } from "@tanstack/react-query";

import { BUS_EVENTS, type MessagesDecryptedEvent } from "../../../core/events/busEvents";
import { eventBus } from "../../../core/events/eventBus";
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
import { useContactStore } from "../../relay/contacts/useContactStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { makeConversation } from "../../conversations/__fixtures__/conversations";
import { useNotificationSettingsStore } from "../state/useNotificationSettingsStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { announceNotificationDue } from "../state/notificationEvents";
import { seenRecently, useNotificationEventHandler } from "./useNotificationEventHandler";

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

/** The cache sync's announcement that these messages were decrypted into the store. */
function decrypted(messageIds: string[]) {
  eventBus.emit<MessagesDecryptedEvent>(BUS_EVENTS.MESSAGES_DECRYPTED, {
    workspaceId: "ws-1",
    conversationId: "c-general",
    messageIds,
  });
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
      useNotificationEventHandler();
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
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useNotificationSettingsStore.setState({
      enabled: true,
      soundEnabled: true,
      preview: "full",
      hideEncryptedText: false,
      title: "conversation",
    });
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
        extra: {
          rimMessage: {
            workspaceId: "ws-1",
            conversationId: "c-general",
            messageId: "m-1",
            threadId: null,
          },
        },
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

  describe("the conversation that is open", () => {
    function openGeneral() {
      useShellStore.setState({
        mainSurface: { kind: "conversation" },
        selectedConversationId: "c-general",
      } as Partial<ReturnType<typeof useShellStore.getState>>);
      vi.spyOn(document, "hasFocus").mockReturnValue(true);
    }

    it("does not notify while the person is looking at it", async () => {
      openGeneral();
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
      setup();
      emit(notificationDue());
      await new Promise((r) => setTimeout(r, 20));
      expect(sendNotification).not.toHaveBeenCalled();
    });

    it("notifies while the window is hidden, even if it still reports focus", async () => {
      openGeneral();
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      setup();
      emit(notificationDue());
      await waitFor(() => expect(sendNotification).toHaveBeenCalled());
    });
  });

  it("respects the device toggles: disabled shows nothing", async () => {
    useNotificationSettingsStore.setState({ enabled: false });
    setup();
    emit(notificationDue());
    await new Promise((r) => setTimeout(r, 0));
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("respects the device toggles: no preview and no sound", async () => {
    useNotificationSettingsStore.setState({ soundEnabled: false, preview: "sender" });
    setup();
    emit(notificationDue());
    await waitFor(() =>
      expect(sendNotification).toHaveBeenCalledWith({
        title: "#general",
        body: "New message from Alice",
        extra: {
          rimMessage: {
            workspaceId: "ws-1",
            conversationId: "c-general",
            messageId: "m-1",
            threadId: null,
          },
        },
      }),
    );
  });

  describe("the target a click opens", () => {
    function lastTarget() {
      const options = vi.mocked(sendNotification).mock.lastCall?.[0];
      return typeof options === "object" ? options.extra?.rimMessage : undefined;
    }

    it("names the thread of a reply held in the cache", async () => {
      const qc = setup({ seed: false });
      qc.setQueryData(queryKeys.joinedChannels("ws-1"), {
        items: [general],
        pageInfo: { hasNext: false, hasPrev: false },
      });
      const messages = cachedMessages();
      Object.assign(messages.pages[0].items[0], { threadId: "t-1" });
      qc.setQueryData(queryKeys.messages("ws-1", "c-general"), messages);
      emit(notificationDue());
      await waitFor(() => expect(sendNotification).toHaveBeenCalled());
      expect(lastTarget()).toEqual({
        workspaceId: "ws-1",
        conversationId: "c-general",
        messageId: "m-1",
        threadId: "t-1",
      });
    });

    it("asks the server for the thread of a message it has to load", async () => {
      requestMock.mockImplementation((document: string) =>
        String(document).includes("NotificationDueContext")
          ? Promise.resolve({
              message: {
                id: "m-9",
                threadId: "t-2",
                authorId: "u-bob",
                author: { id: "u-bob", username: "bob", displayName: null },
                text: "in the thread",
              },
            })
          : new Promise(() => {}),
      );
      setup();
      emit(notificationDue({ message_id: "m-9" }));
      await waitFor(() => expect(sendNotification).toHaveBeenCalled());
      expect(lastTarget()).toEqual({
        workspaceId: "ws-1",
        conversationId: "c-general",
        messageId: "m-9",
        threadId: "t-2",
      });
      const context = requestMock.mock.calls.find(([document]) =>
        String(document).includes("NotificationDueContext"),
      );
      expect(String(context?.[0])).toMatch(/\bthreadId\b/);
    });

    it("has no thread when the message could not be loaded", async () => {
      requestMock.mockImplementation((document: string) =>
        String(document).includes("NotificationDueContext")
          ? Promise.reject(new Error("offline"))
          : new Promise(() => {}),
      );
      setup();
      emit(notificationDue({ message_id: "m-9" }));
      await waitFor(() => expect(sendNotification).toHaveBeenCalled());
      expect(lastTarget()).toEqual({
        workspaceId: "ws-1",
        conversationId: "c-general",
        messageId: "m-9",
        threadId: null,
      });
    });
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
      expect(sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "#general",
          body: "bob: deploy is done",
          sound: "Ping",
        }),
      ),
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

    // m-10 is never stored decrypted: once the sync that carried it is done, the notification
    // says it is encrypted.
    emit(notificationDue({ notification_id: "n-2", message_id: "m-10" }));
    await waitFor(() =>
      expect(readCachedMessageMock).toHaveBeenCalledWith(expect.anything(), "m-10"),
    );
    decrypted(["m-10"]);
    await waitFor(() =>
      expect(sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({ body: "bob: Encrypted message" }),
      ),
    );
  });

  it("waits for an encrypted message that arrives before it is decrypted here", async () => {
    storeAccountMock.mockReturnValue({ endpoint: "http://localhost:8080/api", userId: "me" });
    readCachedMessageMock.mockResolvedValue(null);
    requestMock.mockImplementation((document: string) =>
      String(document).includes("NotificationDueContext")
        ? Promise.resolve({
            message: {
              id: "m-9",
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
      expect(readCachedMessageMock).toHaveBeenCalledWith(expect.anything(), "m-9"),
    );
    expect(sendNotification).not.toHaveBeenCalled();

    readCachedMessageMock.mockResolvedValue({
      id: "m-9",
      text: "whatsup buddy",
      e2ee: { status: "decrypted" },
    });
    decrypted(["m-9"]);
    await waitFor(() =>
      expect(sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({ body: "bob: whatsup buddy" }),
      ),
    );
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("hides an encrypted message's text when this device asks to, but not a plaintext one's", async () => {
    useNotificationSettingsStore.setState({ hideEncryptedText: true });
    storeAccountMock.mockReturnValue({ endpoint: "http://localhost:8080/api", userId: "me" });
    readCachedMessageMock.mockResolvedValue({
      id: "m-9",
      text: "the plan",
      e2ee: { status: "decrypted" },
    });
    requestMock.mockImplementation((document: string) =>
      String(document).includes("NotificationDueContext")
        ? Promise.resolve({
            message: {
              id: "m-9",
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
        expect.objectContaining({ body: "New message from bob" }),
      ),
    );

    // m-1 is a plaintext message in the timeline cache.
    emit(notificationDue({ notification_id: "n-2", message_id: "m-1" }));
    await waitFor(() =>
      expect(sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({ body: "Alice: hello @me" }),
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
      expect(sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Alice",
          body: "Alice: hi",
          sound: "Ping",
        }),
      ),
    );
  });

  describe("an untitled group whose space's member list is not cached", () => {
    function seedGroup() {
      const group = makeConversation({
        id: "c-group",
        title: null,
        conversationType: ConversationTypeEnum.GROUP,
        memberIds: ["me", "u-alice", "u-carol"],
      });
      const qc = setup();
      qc.setQueryData(queryKeys.conversations("ws-1"), {
        items: [group],
        pageInfo: { hasNext: false, hasPrev: false },
      });
      qc.setQueryData(queryKeys.messages("ws-1", "c-group"), {
        pageParams: [null],
        pages: [
          {
            items: [
              {
                id: "m-5",
                authorId: "u-alice",
                author: { id: "u-alice", username: "alice", displayName: "Alice" },
                text: "hello group",
              },
            ],
          },
        ],
      });
      return qc;
    }

    function answerMembers() {
      requestMock.mockImplementation((document: unknown) =>
        String(document).includes("query ServerMembers")
          ? Promise.resolve({
              serverMembers: [
                { userId: "u-alice", username: "alice", displayName: "Alice" },
                {
                  userId: "u-carol",
                  username: "carol",
                  displayName: "Carol",
                  principalId: "p-carol",
                },
              ],
            })
          : new Promise(() => {}),
      );
    }

    afterEach(() => {
      useContactStore.setState({ aliases: {} });
    });

    it("names an untitled group after its members", async () => {
      answerMembers();
      seedGroup();
      emit(notificationDue({ conversation_id: "c-group", message_id: "m-5", reason: "direct" }));

      await waitFor(() =>
        expect(sendNotification).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Alice and Carol",
            body: "Alice: hello group",
            sound: "Ping",
          }),
        ),
      );
    });

    it("names group members by the alias the sidebar shows", async () => {
      answerMembers();
      useContactStore.setState({ aliases: { "p-carol": "Caz" } });
      seedGroup();
      emit(notificationDue({ conversation_id: "c-group", message_id: "m-5", reason: "direct" }));

      await waitFor(() =>
        expect(sendNotification).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Alice and Caz",
            body: "Alice: hello group",
            sound: "Ping",
          }),
        ),
      );
    });
  });

  it("shows the preview as plain text with mentions named", async () => {
    const qc = setup();
    qc.setQueryData(queryKeys.serverMembers("ws-1"), [
      { userId: "u-alice", username: "alice", displayName: "Alice" },
      { userId: "u-priya", username: "priya", displayName: "Priya Nair", principalId: "rimp1_p" },
    ]);
    qc.setQueryData(queryKeys.messages("ws-1", "c-general"), {
      pageParams: [null],
      pages: [
        {
          items: [
            {
              id: "m-3",
              authorId: "u-alice",
              author: null,
              text: "**Release 2.1** is out, <@u-priya> and <@rimp1_p>, see <@u-gone>",
            },
          ],
        },
      ],
    });
    emit(notificationDue({ message_id: "m-3" }));

    await waitFor(() =>
      expect(sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "#general",
          body: "Alice: Release 2.1 is out, @Priya Nair and @Priya Nair, see @member",
          sound: "Ping",
        }),
      ),
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

  describe("a workspace that is not open", () => {
    function seedOther() {
      const qc = setup();
      qc.setQueryData(queryKeys.myServers(), [{ id: "ws-2", name: "Beta", owner: null }]);
      qc.setQueryData(queryKeys.joinedChannels("ws-2"), {
        items: [{ ...general, serverId: "ws-2" }],
        pageInfo: { hasNext: false, hasPrev: false },
      });
      qc.setQueryData(queryKeys.messages("ws-2", "c-general"), cachedMessages());
      return qc;
    }

    function due(workspaceId: string, notificationId: string) {
      return {
        workspaceId,
        notificationId,
        conversationId: "c-general",
        messageId: "m-1",
        reason: "mention" as const,
        quiet: false,
      };
    }

    it("notifies for a workspace that is not open and names it in the title", async () => {
      const qc = seedOther();
      announceNotificationDue(qc, due("ws-2", "n-1"));
      await waitFor(() =>
        expect(sendNotification).toHaveBeenCalledWith({
          title: "#general · Beta",
          body: "Alice: hello @me",
          sound: "Ping",
          extra: {
            rimMessage: {
              workspaceId: "ws-2",
              conversationId: "c-general",
              messageId: "m-1",
              threadId: null,
            },
          },
        }),
      );
    });

    it("does not name the open workspace", async () => {
      setup();
      emit(notificationDue());
      await waitFor(() => expect(sendNotification).toHaveBeenCalled());
      const sent = vi.mocked(sendNotification).mock.calls[0][0] as { title: string };
      expect(sent.title).not.toContain(" · ");
    });

    it("shows a notification that arrives on two streams once", async () => {
      const qc = seedOther();
      announceNotificationDue(qc, due("ws-2", "n-1"));
      announceNotificationDue(qc, due("ws-2", "n-1"));
      await waitFor(() => expect(sendNotification).toHaveBeenCalledTimes(1));
      await new Promise((r) => setTimeout(r, 0));
      expect(sendNotification).toHaveBeenCalledTimes(1);

      announceNotificationDue(qc, due("ws-2", "n-2"));
      await waitFor(() => expect(sendNotification).toHaveBeenCalledTimes(2));
    });

    it("reads the unread count of a workspace that is not open, for its rail badge", () => {
      const qc = seedOther();
      const spy = vi.spyOn(qc, "invalidateQueries");
      announceNotificationDue(qc, due("ws-2", "n-1"));
      expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.unreadCounts("ws-2") });
    });

    it("leaves the open workspace's unread count to its message events", () => {
      const qc = seedOther();
      const spy = vi.spyOn(qc, "invalidateQueries");
      announceNotificationDue(qc, due("ws-1", "n-1"));
      expect(spy).not.toHaveBeenCalledWith({ queryKey: queryKeys.unreadCounts("ws-1") });
    });

    it("shows only New message with no preview, whichever workspace it came from", async () => {
      useNotificationSettingsStore.setState({ preview: "none" });
      const qc = seedOther();
      announceNotificationDue(qc, due("ws-2", "n-1"));
      await waitFor(() =>
        expect(sendNotification).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "RIM",
            body: "New message",
            sound: "Ping",
          }),
        ),
      );
    });
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

describe("seenRecently", () => {
  it("is true for a repeat inside the window and false after it", () => {
    const seen = new Map<string, number>();
    expect(seenRecently(seen, "n-1", 1000)).toBe(false);
    expect(seenRecently(seen, "n-1", 5000)).toBe(true);
    expect(seenRecently(seen, "n-1", 11_000)).toBe(false);
  });

  it("removes entries past the window", () => {
    const seen = new Map<string, number>();
    seenRecently(seen, "old", 0);
    seenRecently(seen, "new", 20_000);
    expect([...seen.keys()]).toEqual(["new"]);
  });
});
