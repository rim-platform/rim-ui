import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { createTestQueryClient } from "../../../test/utils";
import { SERVER_FAULT_MESSAGE } from "../../../core/graphql/errors";
import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";
import { useShellStore, type DirectDraft } from "../../../shell/state/useShellStore";
import { toast } from "../../../shared/toast/useToastStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { directDraftKey } from "../../conversations/state/openDirect";
import { NotReadyError } from "../../relay/conversations/startDirect";
import { useDraftStore } from "../state/useDraftStore";
import {
  baseReadHandlers,
  callsTo,
  graphqlError,
  makeConversation,
  routeRequests,
} from "../../conversations/__fixtures__/conversations";

const requestMock = vi.fn();
const sendEncrypted = vi.hoisted(() => vi.fn());
const session = vi.hoisted(() => ({ e2eeSession: vi.fn() }));
const groups = vi.hoisted(() => ({ allMembersReady: vi.fn(), createGroup: vi.fn() }));

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));
vi.mock("../../../shared/toast/useToastStore", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
  useToastStore: vi.fn(),
}));
vi.mock("../hooks/useTypingIndicator", () => ({
  useTypingIndicator: () => ({ handleKeystroke: () => {}, markSent: () => {} }),
}));
vi.mock("../../e2ee/runtime/send", () => ({
  sendEncrypted,
  EncryptedSendError: class extends Error {},
  EncryptedUploadError: class extends Error {},
}));
vi.mock("../../e2ee/runtime/session", () => session);
vi.mock("../../e2ee/runtime/groups", () => groups);
vi.mock("../../e2ee/web/webAccount", () => ({ isWebAccount: () => false }));
const relay = vi.hoisted(() => ({ startDirectConversation: vi.fn() }));
vi.mock("../../relay/conversations/startDirect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../relay/conversations/startDirect")>()),
  ...relay,
}));

import { Composer } from "./Composer";

const toBob: DirectDraft = { workspaceId: "ws-1", otherUserId: "u-bob" };
const device = { account: {}, userId: "me", principalId: "rimp1_me", deviceId: "d1" };

/** The DM the server creates (or hands back) for the draft. */
function created(encryptedAt: string | null) {
  return makeConversation({
    id: "c-new",
    title: null,
    conversationType: ConversationTypeEnum.DIRECT,
    memberIds: ["me", "u-bob"],
    encryptedAt,
  });
}

function serve(handlers: Parameters<typeof routeRequests>[1]) {
  routeRequests(requestMock, { ...baseReadHandlers, ...handlers });
}

/** Renders the draft's composer, types `text` and submits it. */
async function sendFirst(text: string, encrypted = false, target: DirectDraft = toBob) {
  const workspaceId = "spaceId" in target ? target.spaceId : target.workspaceId;
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <Composer workspaceId={workspaceId} draft={{ target, encrypted }} />
    </QueryClientProvider>,
  );
  const textbox = await screen.findByRole("textbox");
  fireEvent.change(textbox, { target: { value: text } });
  fireEvent.submit(textbox.closest("form")!);
  return textbox as HTMLTextAreaElement;
}

/** The index of the first request whose document contains `needle`. */
function requestIndex(needle: string) {
  return requestMock.mock.calls.findIndex(([doc]) => String(doc).includes(needle));
}

beforeEach(() => {
  requestMock.mockReset();
  sendEncrypted.mockReset();
  Object.values({ ...session, ...groups, ...relay }).forEach((fn) => fn.mockReset());
  vi.mocked(toast.error).mockReset();
  groups.createGroup.mockResolvedValue(true);
  groups.allMembersReady.mockResolvedValue(false);
  useDraftStore.setState({ drafts: {} });
  useWorkspaceStore.setState({ workspaceId: "ws-1" });
  useAuthStore.getState().setSession({ userId: "me" });
  useShellStore.getState().openDraftDirect(toBob);
});

describe("Composer in a draft DM", () => {
  it("creates the conversation, sends the first message there and opens it", async () => {
    session.e2eeSession.mockResolvedValue(null);
    serve({
      "mutation CreateConversation": () => ({ createConversation: created(null) }),
      "mutation SendMessage": () => ({ sendMessage: { id: "m-1" } }),
    });
    await sendFirst("hello Bob");

    await waitFor(() => expect(useShellStore.getState().selectedConversationId).toBe("c-new"));
    expect(useShellStore.getState().draftDirect).toBeNull();
    expect(callsTo(requestMock, "mutation CreateConversation")).toEqual([
      { input: { serverId: "ws-1", otherUserId: "u-bob" } },
    ]);
    expect(callsTo(requestMock, "mutation SendMessage")).toEqual([
      { input: expect.objectContaining({ conversationId: "c-new", text: "hello Bob" }) },
    ]);
    expect(requestIndex("mutation CreateConversation")).toBeLessThan(
      requestIndex("mutation SendMessage"),
    );
    expect(useDraftStore.getState().drafts).toEqual({});
  });

  it("leaves open a main-area plugin panel the user opened while the first message was sending", async () => {
    session.e2eeSession.mockResolvedValue(null);
    serve({
      "mutation CreateConversation": () => ({ createConversation: created(null) }),
      "mutation SendMessage": () => {
        useShellStore.getState().openPluginPanel("chat.rim.k8s-pods", "pods", "main_area");
        return { sendMessage: { id: "m-1" } };
      },
    });
    await sendFirst("hello Bob");

    await waitFor(() => expect(useShellStore.getState().selectedConversationId).toBe("c-new"));
    expect(useShellStore.getState().activePluginPanel).toMatchObject({ panelId: "pods" });
  });

  it("creates the group before the first encrypted message goes out", async () => {
    session.e2eeSession.mockResolvedValue(device);
    sendEncrypted.mockResolvedValue("m-1");
    serve({
      "mutation CreateConversation": () => ({
        createConversation: created("2026-10-16T00:00:00Z"),
      }),
    });
    await sendFirst("secret", true);

    await waitFor(() => expect(useShellStore.getState().selectedConversationId).toBe("c-new"));
    expect(groups.createGroup).toHaveBeenCalledWith(device, "ws-1", "c-new");
    expect(sendEncrypted).toHaveBeenCalledWith(
      "ws-1",
      "c-new",
      expect.objectContaining({ body: "secret" }),
    );
    expect(groups.createGroup.mock.invocationCallOrder[0]).toBeLessThan(
      sendEncrypted.mock.invocationCallOrder[0],
    );
    expect(callsTo(requestMock, "mutation SendMessage")).toHaveLength(0);
  });

  it("keeps the text and the draft when the conversation cannot be created", async () => {
    session.e2eeSession.mockResolvedValue(null);
    serve({
      "mutation CreateConversation": () => {
        throw graphqlError("FORBIDDEN", "You cannot message this person");
      },
    });
    const textbox = await sendFirst("hello Bob");

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("You cannot message this person"));
    expect(textbox.value).toBe("hello Bob");
    expect(useShellStore.getState().draftDirect).toEqual(toBob);
    expect(callsTo(requestMock, "mutation SendMessage")).toHaveLength(0);
  });

  it("keeps the text and the draft when the first message fails to send", async () => {
    session.e2eeSession.mockResolvedValue(null);
    serve({
      "mutation CreateConversation": () => ({ createConversation: created(null) }),
      "mutation SendMessage": () => {
        throw graphqlError("INTERNAL", "Something went wrong");
      },
    });
    const textbox = await sendFirst("hello Bob");

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(SERVER_FAULT_MESSAGE));
    await waitFor(() => expect(textbox.value).toBe("hello Bob"));
    expect(useShellStore.getState().draftDirect).toEqual(toBob);
    expect(useDraftStore.getState().drafts[directDraftKey(toBob)]).toBe("hello Bob");
  });

  it("sends nothing when the draft promised encryption and the server hands back a plaintext DM", async () => {
    session.e2eeSession.mockResolvedValue(device);
    serve({ "mutation CreateConversation": () => ({ createConversation: created(null) }) });
    await sendFirst("secret", true);

    await waitFor(() => expect(useShellStore.getState().selectedConversationId).toBe("c-new"));
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/^Not sent: .+ not end-to-end encrypted/),
    );
    expect(useDraftStore.getState().drafts).toEqual({ "c-new": "secret" });
    expect(sendEncrypted).not.toHaveBeenCalled();
    expect(callsTo(requestMock, "mutation SendMessage")).toHaveLength(0);
  });

  describe("in a direct space", () => {
    const toDan: DirectDraft = {
      spaceId: "direct-1",
      member: { principalId: "rimp1_dan", relayUrls: [], name: "Dan" },
    };

    beforeEach(() => {
      useWorkspaceStore.setState({ workspaceId: "direct-1" });
      useShellStore.getState().openDraftDirect(toDan);
      serve({ "mutation SendMessage": () => ({ sendMessage: { id: "m-1" } }) });
    });

    it("starts the DM in the direct space, sends there and opens it", async () => {
      relay.startDirectConversation.mockResolvedValue({
        spaceId: "direct-1",
        conversationId: "c-dan",
        encrypted: false,
        group: null,
      });
      await sendFirst("hi Dan", false, toDan);

      await waitFor(() => expect(useShellStore.getState().selectedConversationId).toBe("c-dan"));
      expect(relay.startDirectConversation).toHaveBeenCalledWith([toDan.member]);
      expect(callsTo(requestMock, "mutation SendMessage")).toEqual([
        { input: expect.objectContaining({ conversationId: "c-dan", text: "hi Dan" }) },
      ]);
      expect(useWorkspaceStore.getState().workspaceId).toBe("direct-1");
    });

    it("the first message of a draft from a workspace names the created DM in the way back", async () => {
      const origin = { workspaceId: "ws-1", conversationId: "c-design", spaceId: "direct-1" };
      useShellStore.getState().setDirectOrigin({ ...origin, openedId: null });
      relay.startDirectConversation.mockResolvedValue({
        spaceId: "direct-1",
        conversationId: "c-dan",
        encrypted: false,
        group: null,
      });
      await sendFirst("hi Dan", false, toDan);

      await waitFor(() => expect(useShellStore.getState().selectedConversationId).toBe("c-dan"));
      expect(useShellStore.getState().directOrigin).toEqual({ ...origin, openedId: "c-dan" });
      useShellStore.getState().setDirectOrigin(null);
    });

    it("names who cannot receive encrypted messages and keeps the draft", async () => {
      relay.startDirectConversation.mockRejectedValue(new NotReadyError(["Dan"]));
      const textbox = await sendFirst("hi Dan", false, toDan);

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          expect.stringMatching(/^Dan cannot receive encrypted messages yet/),
        ),
      );
      expect(textbox.value).toBe("hi Dan");
      expect(useShellStore.getState().draftDirect).toEqual(toDan);
      expect(callsTo(requestMock, "mutation SendMessage")).toHaveLength(0);
    });
  });
});
