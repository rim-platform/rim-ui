import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { createTestQueryClient } from "../../../test/utils";
import { ServerMemberRoleGql } from "../../../core/graphql/generated/schema-types";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import {
  baseReadHandlers,
  makeConversation,
  routeRequests,
  workspaceMembers,
} from "../../conversations/__fixtures__/conversations";

const requestMock = vi.fn();
const sendEncrypted = vi.hoisted(() => vi.fn());

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

import { Composer, ThreadComposer } from "./Composer";

const members = workspaceMembers.map((m) => ({
  ...m,
  principalId: m.userId === "u-alice" ? "rimp1_alice" : m.userId === "me" ? "rimp1_me" : null,
}));

/** Serves the composer's reads in an encrypted conversation. */
function serveReads() {
  routeRequests(requestMock, {
    ...baseReadHandlers,
    "query ServerMembers": () => ({ serverMembers: members }),
    "query Server(": () => ({
      server: { id: "ws-1", name: "Acme", viewerRole: ServerMemberRoleGql.MEMBER },
    }),
    "query Conversation(": () => ({
      conversation: makeConversation({ encryptedAt: "2026-10-09T00:00:00Z" }),
    }),
  });
}

function renderComposer(sendBlock: "unverified" | null) {
  serveReads();
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <Composer workspaceId="ws-1" conversationId="conv-1" encryption={{ sendBlock }} />
    </QueryClientProvider>,
  );
}

/** Whether any GraphQL request so far contains `needle`. */
function requested(needle: string): boolean {
  return requestMock.mock.calls.some(([doc]) => String(doc).includes(needle));
}

describe("Composer in an encrypted conversation", () => {
  beforeEach(() => {
    requestMock.mockReset();
    sendEncrypted.mockReset();
    sendEncrypted.mockResolvedValue("m-1");
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useAuthStore.getState().setSession({ userId: "me" });
  });

  it("sends through the encrypted path with mentions as principal tokens", async () => {
    renderComposer(null);
    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    const textbox = await screen.findByRole("textbox");
    fireEvent.change(textbox, { target: { value: "hi <@u-alice>" } });
    fireEvent.submit(textbox.closest("form")!);

    await waitFor(() => expect(sendEncrypted).toHaveBeenCalled());
    const [ws, conversation, draft] = sendEncrypted.mock.calls[0];
    expect([ws, conversation]).toEqual(["ws-1", "conv-1"]);
    expect(draft.body).toBe("hi <@rimp1_alice>");
    expect(draft.author).toMatchObject({ id: "me", principalId: "rimp1_me" });
    expect(draft.threadRootId).toBeUndefined();
    expect(requested("mutation SendMessage")).toBe(false);
  });

  it("sends a thread reply through the encrypted path with its root and thread", async () => {
    serveReads();
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <ThreadComposer
          workspaceId="ws-1"
          conversationId="conv-1"
          thread={{ rootMessageId: "root-1", threadId: "t-1" }}
          encryption={{ sendBlock: null }}
        />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    const textbox = await screen.findByRole("textbox");
    fireEvent.change(textbox, { target: { value: "hi <@u-alice>" } });
    fireEvent.submit(textbox.closest("form")!);

    await waitFor(() => expect(sendEncrypted).toHaveBeenCalled());
    const [ws, conversation, draft] = sendEncrypted.mock.calls[0];
    expect([ws, conversation]).toEqual(["ws-1", "conv-1"]);
    expect(draft).toMatchObject({
      threadRootId: "root-1",
      threadId: "t-1",
      body: "hi <@rimp1_alice>",
    });
    expect(requested("mutation ReplyToMessage")).toBe(false);
    expect(requested("mutation SendMessage")).toBe(false);
  });

  it("does not send while sending is stopped", async () => {
    renderComposer("unverified");
    const textbox = await screen.findByRole("textbox");
    fireEvent.change(textbox, { target: { value: "blocked" } });
    fireEvent.submit(textbox.closest("form")!);
    await new Promise((r) => setTimeout(r, 0));
    expect(sendEncrypted).not.toHaveBeenCalled();
  });
});
