import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

const request = vi.hoisted(() => vi.fn());
const commands = vi.hoisted(() => ({ status: vi.fn(), pin: vi.fn() }));
const members = vi.hoisted(() => ({ conversationMembers: vi.fn() }));
vi.mock("../../../core/graphql/client", () => ({ graphqlClient: { request } }));
vi.mock("../api/e2eeCommands", () => ({ e2eeCommands: commands }));
vi.mock("./members", () => members);
vi.mock("./session", () => ({
  e2eeSession: async () => session,
}));

import { queryKeys } from "../../../core/query/keys";
import { TestProviders } from "../../../test/utils";
import { useEditMessageMutation } from "../../messages/api/useEditMessage";
import { useForwardMessageMutation } from "../../messages/api/useForwardMessage";
import { useSendMessageMutation } from "../../messages/api/useMessages";
import { useReplyToMessageMutation } from "../../threads/api/useReplyToMessage";
import { useE2eeStore } from "../state/useE2eeStore";
import {
  EncryptedConversationError,
  foreignPrincipals,
  pinConversation,
  PinnedEncryptedError,
} from "./pins";

const session = {
  account: { endpoint: "http://x/api", userId: "u-me" },
  userId: "u-me",
  principalId: "rimp1_me",
  deviceId: "dev-me",
};

function view(overrides: Record<string, unknown> = {}) {
  return {
    conversationId: "c",
    pinned: false,
    pinnedEncryptedAt: null,
    dmPrincipals: null,
    ...overrides,
  };
}

function hook<T>(use: () => T): T {
  return renderHook(use, { wrapper: TestProviders }).result.current;
}

describe("pins", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useE2eeStore.getState().clear();
    request.mockResolvedValue({});
  });

  it("finding 1: a server flipping encryptedAt to null never produces a sendMessage call", async () => {
    // The UI has not refreshed the group yet; the encryption backend knows the pin.
    commands.status.mockResolvedValue([view({ pinned: true })]);
    const send = hook(useSendMessageMutation);
    await expect(
      send.mutateAsync({ workspaceId: "ws", conversationId: "c", text: "plaintext" }),
    ).rejects.toBeInstanceOf(PinnedEncryptedError);
    const reply = hook(useReplyToMessageMutation);
    await expect(
      reply.mutateAsync({
        serverId: "ws",
        conversationId: "c",
        rootMessageId: "m",
        text: "plaintext",
      }),
    ).rejects.toBeInstanceOf(PinnedEncryptedError);
    const edit = hook(useEditMessageMutation);
    await expect(
      edit.mutateAsync({ serverId: "ws", conversationId: "c", messageId: "m", text: "plaintext" }),
    ).rejects.toBeInstanceOf(PinnedEncryptedError);
    const forward = hook(useForwardMessageMutation);
    await expect(
      forward.mutateAsync({
        serverId: "ws",
        sourceConversationId: "other",
        targetConversationId: "c",
        messageId: "m",
      }),
    ).rejects.toBeInstanceOf(PinnedEncryptedError);
    expect(request).not.toHaveBeenCalled();

    // A conversation this device never saw encrypted sends as before.
    commands.status.mockResolvedValue([view({ conversationId: "plain" })]);
    await send.mutateAsync({ workspaceId: "ws", conversationId: "plain", text: "hi" });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("never sends plaintext into a conversation the server's cached answer calls encrypted", async () => {
    // Not pinned on this device yet: the server's answer alone stops the plaintext write.
    commands.status.mockResolvedValue([view({ conversationId: "dm" })]);
    // Kept past garbage collection: nothing observes these answers while the guard reads them.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(queryKeys.conversation("space", "dm"), {
      id: "dm",
      encryptedAt: "2026-10-01T00:00:00Z",
    });
    qc.setQueryData(queryKeys.conversation("space", "plain"), { id: "plain", encryptedAt: null });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children);
    const send = renderHook(useSendMessageMutation, { wrapper }).result.current;
    await expect(
      send.mutateAsync({ workspaceId: "space", conversationId: "dm", text: "plaintext" }),
    ).rejects.toBeInstanceOf(EncryptedConversationError);
    const reply = renderHook(useReplyToMessageMutation, { wrapper }).result.current;
    await expect(
      reply.mutateAsync({
        serverId: "space",
        conversationId: "dm",
        rootMessageId: "m",
        text: "plaintext",
      }),
    ).rejects.toBeInstanceOf(EncryptedConversationError);
    expect(request).not.toHaveBeenCalled();

    await send.mutateAsync({ workspaceId: "space", conversationId: "plain", text: "hi" });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("finding 4: pins a direct message to its two principals on first use only", async () => {
    commands.status.mockResolvedValue([view()]);
    commands.pin.mockImplementation(async (_a, _w, id, at, dm) =>
      view({ conversationId: id, pinned: true, pinnedEncryptedAt: at, dmPrincipals: dm }),
    );
    members.conversationMembers.mockResolvedValue([
      { userId: "u-me", principalId: "rimp1_me" },
      { userId: "u-bob", principalId: "rimp1_bob" },
    ]);
    const dm = {
      id: "c",
      conversationType: "DIRECT" as never,
      memberIds: ["u-me", "u-bob"],
      encryptedAt: "2026-10-09T00:00:00Z",
    };
    const pinned = await pinConversation(session, "ws", dm);
    expect(commands.pin).toHaveBeenCalledWith(session.account, "ws", "c", "2026-10-09T00:00:00Z", [
      "rimp1_me",
      "rimp1_bob",
    ]);
    expect(useE2eeStore.getState().groups.c).toEqual(pinned);

    // A server listing three members in a direct message gets no pair pinned.
    commands.pin.mockClear();
    await pinConversation(session, "ws", { ...dm, id: "d", memberIds: ["u-me", "u-bob", "u-m"] });
    expect(commands.pin.mock.calls[0][4]).toBeNull();

    // Once pinned, nothing is asked again.
    commands.pin.mockClear();
    commands.status.mockResolvedValue([pinned]);
    await pinConversation(session, "ws", dm);
    expect(commands.pin).not.toHaveBeenCalled();

    expect(foreignPrincipals(["rimp1_bob", "rimp1_me"], ["rimp1_me", "rimp1_m", null])).toEqual([
      "rimp1_m",
    ]);
    expect(foreignPrincipals(null, ["rimp1_m"])).toEqual([]);
  });
});
