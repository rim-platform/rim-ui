import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { createTestQueryClient } from "../../../test/utils";
import type { MessageItem } from "../../../core/types/messages";
import { ServerMemberRoleGql } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import {
  callsTo,
  graphqlError,
  routeRequests,
} from "../../conversations/__fixtures__/conversations";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));
vi.mock("../../../shared/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));
vi.mock("../../plugins/api/usePluginCommands", () => ({
  usePluginContextMenuCommands: () => [],
}));

import { toast } from "../../../shared/toast";
import { ConfirmCommandModal } from "../../agent/components/ConfirmCommandModal";
import { useConfirmationModalStore } from "../../agent/state/confirmationModalStore";
import { MessageContextMenu } from "./MessageContextMenu";

const challenge = { token: "tok-1", argsHash: "hash-1", expiresAt: "2999-01-01T00:00:00Z" };
const deleteContext = { workspaceId: "ws-1", conversationId: "conv-1", selectedMessageId: "msg-1" };

/** `ExecuteCommand` answers: held for confirmation first, then `then` for the confirmed re-send. */
function heldThen(then: () => unknown) {
  let calls = 0;
  return () => {
    calls += 1;
    if (calls > 1) return then();
    return {
      executeCommand: {
        status: "CONFIRMATION_REQUIRED",
        message: "confirmation required for dangerous command",
        payload: null,
        followUpCommands: [],
        confirmationRequired: challenge,
      },
    };
  };
}

function serve(role: ServerMemberRoleGql, extra: Record<string, () => unknown> = {}) {
  routeRequests(requestMock, {
    "query Server(": () => ({ server: { id: "ws-1", name: "Acme", viewerRole: role } }),
    "mutation ReportMessage": () => ({ reportMessage: { id: "rep-1" } }),
    "mutation ExecuteCommand": () => ({
      executeCommand: { status: "SUCCESS", message: "message deleted", payload: null },
    }),
    ...extra,
  });
}

async function renderMenu(role: ServerMemberRoleGql, isOwnMessage: boolean, message?: MessageItem) {
  const qc = createTestQueryClient();
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <MessageContextMenu
        x={10}
        y={10}
        messageId="msg-1"
        messageText="hello"
        conversationId="conv-1"
        workspaceId="ws-1"
        isOwnMessage={isOwnMessage}
        isPinned={false}
        hasThread={false}
        message={message}
        onClose={onClose}
      />
      <ConfirmCommandModal />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(qc.getQueryData<{ viewerRole: string }>(queryKeys.server("ws-1"))?.viewerRole).toBe(
      role,
    ),
  );
  return { qc, onClose };
}

function labels(): string[] {
  return screen.getAllByRole("menuitem").map((el) => el.textContent ?? "");
}

describe("MessageContextMenu — report and delete", () => {
  beforeEach(() => {
    requestMock.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    useConfirmationModalStore.getState().reset();
  });

  it("offers Report but no Delete on someone else's message to a member", async () => {
    serve(ServerMemberRoleGql.MEMBER);
    await renderMenu(ServerMemberRoleGql.MEMBER, false);
    expect(labels()).toContain("Report Message");
    expect(labels()).not.toContain("Delete Message");
  });

  it("offers no Report on the viewer's own message", async () => {
    serve(ServerMemberRoleGql.MEMBER);
    await renderMenu(ServerMemberRoleGql.MEMBER, true);
    expect(labels()).not.toContain("Report Message");
    expect(labels().filter((l) => l === "Delete Message")).toHaveLength(1);
  });

  it("reports with a required reason and confirms with a toast", async () => {
    serve(ServerMemberRoleGql.GUEST);
    const { onClose } = await renderMenu(ServerMemberRoleGql.GUEST, false);
    fireEvent.click(screen.getByRole("menuitem", { name: "Report Message" }));

    const dialog = screen.getByRole("dialog", { name: "Report message" });
    const submit = within(dialog).getByRole("button", { name: "Report" });
    expect(submit).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Reason"), {
      target: { value: "  harassment " },
    });
    fireEvent.click(submit);

    await waitFor(() =>
      expect(callsTo(requestMock, "mutation ReportMessage")).toEqual([
        { serverId: "ws-1", conversationId: "conv-1", messageId: "msg-1", reason: "harassment" },
      ]),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Message reported to the moderators"),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the server's message when the message was already reported", async () => {
    serve(ServerMemberRoleGql.MEMBER, {
      "mutation ReportMessage": () => {
        throw graphqlError("CONFLICT", "you already reported this message");
      },
    });
    await renderMenu(ServerMemberRoleGql.MEMBER, false);
    fireEvent.click(screen.getByRole("menuitem", { name: "Report Message" }));
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "spam" } });
    fireEvent.click(screen.getByRole("button", { name: "Report" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("you already reported this message");
  });

  it("lets a moderator delete someone else's message once the confirmation dialog is confirmed", async () => {
    serve(ServerMemberRoleGql.MODERATOR, {
      "mutation ExecuteCommand": heldThen(() => ({
        executeCommand: { status: "SUCCESS", message: "message deleted", payload: null },
      })),
    });
    const { onClose } = await renderMenu(ServerMemberRoleGql.MODERATOR, false);
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete Message" }));

    const dialog = await screen.findByRole("dialog", { name: "Confirm: Delete Message" });
    expect(within(dialog).getByText(/as a moderator/)).toBeInTheDocument();
    expect(within(dialog).queryByTestId("initiator-chip")).not.toBeInTheDocument();
    const confirm = within(dialog).getByTestId("confirm-button");
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByTestId("verb-input"), { target: { value: "delete" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Message deleted"));
    expect(callsTo(requestMock, "mutation ExecuteCommand")).toEqual([
      { input: { commandId: "chat.delete_message", commandContext: deleteContext } },
      {
        input: {
          commandId: "chat.delete_message",
          commandContext: deleteContext,
          confirmation: { inBandToken: { token: "tok-1", argsHash: "hash-1" } },
        },
      },
    ]);
    expect(onClose).toHaveBeenCalled();
  });

  it("sends nothing more when the moderator cancels the confirmation", async () => {
    serve(ServerMemberRoleGql.OWNER, {
      "mutation ExecuteCommand": heldThen(() => {
        throw new Error("the re-send must not happen");
      }),
    });
    await renderMenu(ServerMemberRoleGql.OWNER, false);
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete Message" }));

    const dialog = await screen.findByRole("dialog", { name: "Confirm: Delete Message" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(useConfirmationModalStore.getState().request).toBeNull());
    expect(
      screen.queryByRole("dialog", { name: "Confirm: Delete Message" }),
    ).not.toBeInTheDocument();
    expect(callsTo(requestMock, "mutation ExecuteCommand")).toHaveLength(1);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("toasts the server's message when a moderator delete fails", async () => {
    serve(ServerMemberRoleGql.OWNER, {
      "mutation ExecuteCommand": () => {
        throw graphqlError("NOT_FOUND", "not found");
      },
    });
    await renderMenu(ServerMemberRoleGql.OWNER, false);
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete Message" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("not found"));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("deletes the viewer's own message with a plain Confirm, no typed verb", async () => {
    serve(ServerMemberRoleGql.MEMBER, {
      "mutation ExecuteCommand": heldThen(() => ({
        executeCommand: { status: "SUCCESS", message: "message deleted", payload: null },
      })),
    });
    await renderMenu(ServerMemberRoleGql.MEMBER, true);
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete Message" }));

    const dialog = await screen.findByRole("dialog", { name: "Confirm: Delete Message" });
    expect(within(dialog).queryByText(/as a moderator/)).not.toBeInTheDocument();
    expect(within(dialog).queryByTestId("verb-input")).not.toBeInTheDocument();
    const confirm = within(dialog).getByTestId("confirm-button");
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(callsTo(requestMock, "mutation ExecuteCommand")).toHaveLength(2));
    expect(callsTo(requestMock, "mutation ExecuteCommand")[1]).toEqual({
      input: {
        commandId: "chat.delete_message",
        commandContext: deleteContext,
        confirmation: { inBandToken: { token: "tok-1", argsHash: "hash-1" } },
      },
    });
  });
});

function encryptedMessage(e2ee: MessageItem["e2ee"]): MessageItem {
  return {
    id: "msg-1",
    serverId: "ws-1",
    conversationId: "conv-1",
    authorId: "u-bob",
    author: null,
    text: "hello",
    hasAttachments: false,
    isPinned: false,
    mentionedUserIds: [],
    forwardedFromMessageId: null,
    forwardedFrom: null,
    isDeleted: false,
    sentAt: "2026-10-09T00:00:00Z",
    reactions: [],
    attachments: [],
    linkPreviews: [],
    e2ee,
  };
}

const CACHED_E2EE: NonNullable<MessageItem["e2ee"]> = {
  status: "decrypted",
  incarnation: 1,
  epoch: 3,
  senderDeviceId: "dev-bob",
  senderPrincipalId: "rimp1_bob",
  receipt: "cmVjZWlwdA",
  receiptKeyId: 2,
  sentAtUs: "1791504000123456",
  frankingKey: "a2V5",
  rev: 0,
  content: '{"body":"hello"}',
};

describe("MessageContextMenu — reporting an encrypted message", () => {
  beforeEach(() => {
    requestMock.mockReset();
    vi.mocked(toast.success).mockReset();
  });

  it("reports with the content, franking key and receipt from the cache row", async () => {
    serve(ServerMemberRoleGql.MEMBER, {
      "mutation ReportEncryptedMessage": () => ({ reportEncryptedMessage: true }),
    });
    await renderMenu(ServerMemberRoleGql.MEMBER, false, encryptedMessage(CACHED_E2EE));
    fireEvent.click(screen.getByRole("menuitem", { name: "Report Message" }));
    const dialog = screen.getByRole("dialog", { name: "Report message" });
    expect(dialog).toHaveTextContent("sends its exact content and attachments to the server");
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: " threats " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Report" }));

    await waitFor(() =>
      expect(callsTo(requestMock, "mutation ReportEncryptedMessage")).toEqual([
        {
          input: {
            serverId: "ws-1",
            conversationId: "conv-1",
            messageId: "msg-1",
            reason: "threats",
            content: "eyJib2R5IjoiaGVsbG8ifQ",
            frankingKey: "a2V5",
            receipt: "cmVjZWlwdA",
            receiptKeyId: 2,
            senderUserId: "u-bob",
            senderDeviceId: "dev-bob",
            sentAtUs: "1791504000123456",
          },
        },
      ]),
    );
    expect(callsTo(requestMock, "mutation ReportMessage(")).toHaveLength(0);
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Message reported to the moderators"),
    );
  });

  it.each([
    ["a placeholder", { ...CACHED_E2EE, status: "undecryptable" as const }, /could not decrypt/],
    ["an unverified message", { ...CACHED_E2EE, status: "invalid" as const }, /not be verified/],
  ])("refuses to report %s and says why", async (_name, e2ee, why) => {
    serve(ServerMemberRoleGql.MEMBER);
    await renderMenu(ServerMemberRoleGql.MEMBER, false, encryptedMessage(e2ee));
    fireEvent.click(screen.getByRole("menuitem", { name: "Report Message" }));
    const dialog = screen.getByRole("dialog", { name: "Report message" });
    expect(within(dialog).getByRole("alert")).toHaveTextContent(why);
    expect(within(dialog).queryByLabelText("Reason")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Report" })).toBeDisabled();
  });
});
