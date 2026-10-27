import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
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
const pluginCommands = vi.hoisted(() => ({ list: [] as { id: string; title: string }[] }));
vi.mock("../../plugins/api/usePluginCommands", () => ({
  usePluginContextMenuCommands: () => pluginCommands.list,
}));

const dispatched = vi.hoisted(() => vi.fn());
vi.mock("../../commands/runtime/commandDispatcher", () => ({
  dispatchCommand: (...args: unknown[]) => dispatched(...args),
}));

import { toast } from "../../../shared/toast";
import { ConfirmCommandModal } from "../../agent/components/ConfirmCommandModal";
import { useConfirmationModalStore } from "../../agent/state/confirmationModalStore";
import { useContextMenu } from "../../../shared/ui/contextMenu/useContextMenu";
import { useRelayStore } from "../../relay/state/useRelayStore";
import { QUICK_REACTIONS, useMessageContextMenu } from "./useMessageContextMenu";
import { useShellStore } from "../../../shell/state/useShellStore";

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

const onForward = vi.fn();

/** A message row with the conversation's message menu on it. */
function MessageRow({
  isOwnMessage,
  message,
  threadId,
  onReply,
  onEdit,
}: {
  isOwnMessage: boolean;
  message?: MessageItem;
  threadId?: string;
  onReply?: (messageId: string) => void;
  onEdit?: (messageId: string) => void;
}) {
  const contextMenu = useContextMenu();
  const messageMenu = useMessageContextMenu({
    workspaceId: "ws-1",
    conversationId: "conv-1",
    onForward,
    onReply,
    onEdit,
    threadId,
  });
  const target = {
    messageId: "msg-1",
    messageText: "hello",
    isOwnMessage,
    isPinned: false,
    hasThread: false,
    message,
  };
  return (
    <>
      <div
        data-testid="row"
        data-message-id="msg-1"
        tabIndex={0}
        {...contextMenu.bind(() => messageMenu.getItems(target))}
      >
        <span data-testid="text">hello world</span>
      </div>
      <div data-testid="other">elsewhere</div>
      {contextMenu.menu}
      {messageMenu.dialog}
    </>
  );
}

/** Renders the row, waits for the viewer's role, and opens the menu with a right click. */
async function renderMenu(
  role: ServerMemberRoleGql,
  isOwnMessage: boolean,
  message?: MessageItem,
  threadId?: string,
  onReply?: (messageId: string) => void,
  onEdit?: (messageId: string) => void,
) {
  const qc = createTestQueryClient();
  render(
    <QueryClientProvider client={qc}>
      <MessageRow
        isOwnMessage={isOwnMessage}
        message={message}
        threadId={threadId}
        onReply={onReply}
        onEdit={onEdit}
      />
      <ConfirmCommandModal />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(qc.getQueryData<{ viewerRole: string }>(queryKeys.server("ws-1"))?.viewerRole).toBe(
      role,
    ),
  );
  fireEvent.contextMenu(screen.getByTestId("row"));
  return { qc };
}

function menuIsOpen(): boolean {
  return screen.queryByRole("menu") !== null;
}

function labels(): string[] {
  return screen.getAllByRole("menuitem").map((el) => el.textContent ?? "");
}

describe("useMessageContextMenu — report and delete", () => {
  beforeEach(() => {
    requestMock.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    vi.mocked(toast.info).mockReset();
    useConfirmationModalStore.getState().reset();
  });

  it("lists the actions in order, the plugins' message actions last", async () => {
    pluginCommands.list = [{ id: "plugin.translate", title: "Translate" }];
    try {
      serve(ServerMemberRoleGql.MODERATOR);
      await renderMenu(ServerMemberRoleGql.MODERATOR, false);
      expect(labels()).toEqual([
        "Add reaction",
        "Copy text",
        "Reply in thread",
        "Forward…",
        "Pin message",
        "Report message…",
        "Delete message…",
        "Translate",
      ]);
      expect(screen.getByText("Moderation")).toBeInTheDocument();
    } finally {
      pluginCommands.list = [];
    }
  });

  it("offers Edit and Delete on the viewer's own message", async () => {
    serve(ServerMemberRoleGql.MEMBER);
    await renderMenu(ServerMemberRoleGql.MEMBER, true);
    expect(labels()).toEqual([
      "Add reaction",
      "Copy text",
      "Reply in thread",
      "Forward…",
      "Pin message",
      "Edit message",
      "Delete message…",
    ]);
    expect(screen.queryByText("Moderation")).not.toBeInTheDocument();
  });

  it("names the workspace in the report dialog and confirmation", async () => {
    serve(ServerMemberRoleGql.MEMBER);
    const { qc } = await renderMenu(ServerMemberRoleGql.MEMBER, false);
    qc.setQueryData(queryKeys.myServers(), [{ id: "ws-1", name: "Acme", owner: null }]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Report message…" }));
    const dialog = screen.getByRole("dialog", { name: "Report message" });
    expect(within(dialog).getByText(/Moderators of Acme/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "spam" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Report" }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Reported to the moderators of Acme"),
    );
  });

  it("offers Report but no Delete on someone else's message to a member", async () => {
    serve(ServerMemberRoleGql.MEMBER);
    await renderMenu(ServerMemberRoleGql.MEMBER, false);
    expect(labels()).toContain("Report message…");
    expect(labels()).not.toContain("Delete message…");
  });

  it("offers no Report on the viewer's own message", async () => {
    serve(ServerMemberRoleGql.MEMBER);
    await renderMenu(ServerMemberRoleGql.MEMBER, true);
    expect(labels()).not.toContain("Report message…");
    expect(labels().filter((l) => l === "Delete message…")).toHaveLength(1);
  });

  it("reports with a required reason and confirms with a toast", async () => {
    serve(ServerMemberRoleGql.GUEST);
    await renderMenu(ServerMemberRoleGql.GUEST, false);
    fireEvent.click(screen.getByRole("menuitem", { name: "Report message…" }));

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
    expect(menuIsOpen()).toBe(false);
  });

  it("says a report in a DM goes to the people who run the server", async () => {
    useRelayStore.setState({ info: { serverId: "rims1_relay", roles: [], directSpaceId: "ws-1" } });
    try {
      serve(ServerMemberRoleGql.GUEST);
      await renderMenu(ServerMemberRoleGql.GUEST, false);
      fireEvent.click(screen.getByRole("menuitem", { name: "Report message…" }));

      const dialog = screen.getByRole("dialog", { name: "Report message" });
      expect(dialog).toHaveTextContent("The people who run the server this conversation is on");
      expect(dialog).not.toHaveTextContent("Moderators of this workspace");
      fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "spam" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "Report" }));
      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith(
          "Message reported to the people who run the server",
        ),
      );
    } finally {
      useRelayStore.setState({ info: null });
    }
  });

  it("says the message was already reported and closes, without Retry", async () => {
    serve(ServerMemberRoleGql.MEMBER, {
      "mutation ReportMessage": () => {
        throw graphqlError("CONFLICT", "you already reported this message");
      },
    });
    await renderMenu(ServerMemberRoleGql.MEMBER, false);
    fireEvent.click(screen.getByRole("menuitem", { name: "Report message…" }));
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "spam" } });
    fireEvent.click(screen.getByRole("button", { name: "Report" }));

    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith("You already reported this message."),
    );
    expect(screen.queryByRole("dialog", { name: "Report message" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("lets a moderator delete someone else's message once the confirmation dialog is confirmed", async () => {
    serve(ServerMemberRoleGql.MODERATOR, {
      "mutation ExecuteCommand": heldThen(() => ({
        executeCommand: { status: "SUCCESS", message: "message deleted", payload: null },
      })),
    });
    await renderMenu(ServerMemberRoleGql.MODERATOR, false);
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete message…" }));

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
    expect(menuIsOpen()).toBe(false);
  });

  it("sends nothing more when the moderator cancels the confirmation", async () => {
    serve(ServerMemberRoleGql.OWNER, {
      "mutation ExecuteCommand": heldThen(() => {
        throw new Error("the re-send must not happen");
      }),
    });
    await renderMenu(ServerMemberRoleGql.OWNER, false);
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete message…" }));

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
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete message…" }));

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
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete message…" }));

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

describe("useMessageContextMenu — reporting an encrypted message", () => {
  beforeEach(() => {
    requestMock.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.info).mockReset();
  });

  it("says the encrypted message was already reported and closes, without Retry", async () => {
    serve(ServerMemberRoleGql.MEMBER, {
      "mutation ReportEncryptedMessage": () => {
        throw graphqlError("CONFLICT", "you already reported this message");
      },
    });
    await renderMenu(ServerMemberRoleGql.MEMBER, false, encryptedMessage(CACHED_E2EE));
    fireEvent.click(screen.getByRole("menuitem", { name: "Report message…" }));
    const dialog = screen.getByRole("dialog", { name: "Report message" });
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "threats" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Report" }));

    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith("You already reported this message."),
    );
    expect(screen.queryByRole("dialog", { name: "Report message" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("reports with the content, franking key and receipt from the cache row", async () => {
    serve(ServerMemberRoleGql.MEMBER, {
      "mutation ReportEncryptedMessage": () => ({ reportEncryptedMessage: true }),
    });
    await renderMenu(ServerMemberRoleGql.MEMBER, false, encryptedMessage(CACHED_E2EE));
    fireEvent.click(screen.getByRole("menuitem", { name: "Report message…" }));
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
    fireEvent.click(screen.getByRole("menuitem", { name: "Report message…" }));
    const dialog = screen.getByRole("dialog", { name: "Report message" });
    expect(within(dialog).getByRole("alert")).toHaveTextContent(why);
    expect(within(dialog).queryByLabelText("Reason")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Report" })).toBeDisabled();
  });
});

/** Makes `range` the document's only selection. */
function select(range: Range) {
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

describe("useMessageContextMenu — reactions, copying and the thread panel", () => {
  beforeEach(() => {
    requestMock.mockReset();
    onForward.mockReset();
    dispatched.mockReset();
    vi.mocked(toast.success).mockReset();
    window.getSelection()?.removeAllRanges();
  });

  it("toggles a quick reaction from the Add reaction submenu", async () => {
    serve(ServerMemberRoleGql.MEMBER, {
      "mutation ToggleReaction": () => ({
        toggleReaction: { emoji: "🎉", count: 1, reactedByMe: true },
      }),
    });
    await renderMenu(ServerMemberRoleGql.MEMBER, false);
    fireEvent.click(screen.getByRole("menuitem", { name: "Add reaction" }));
    const submenu = screen.getByRole("menu", { name: "Add reaction" });
    expect(
      within(submenu)
        .getAllByRole("menuitem")
        .map((el) => el.textContent),
    ).toEqual([...QUICK_REACTIONS]);
    fireEvent.click(within(submenu).getByRole("menuitem", { name: "🎉" }));

    await waitFor(() =>
      expect(callsTo(requestMock, "mutation ToggleReaction")).toEqual([
        { input: { serverId: "ws-1", conversationId: "conv-1", messageId: "msg-1", emoji: "🎉" } },
      ]),
    );
    expect(menuIsOpen()).toBe(false);
  });

  it("offers Copy selection while text of the message is selected, and copies only it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    serve(ServerMemberRoleGql.MEMBER);
    await renderMenu(ServerMemberRoleGql.MEMBER, false);
    expect(labels()).not.toContain("Copy selection");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    const text = screen.getByTestId("text").firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 5);
    select(range);
    fireEvent.contextMenu(screen.getByTestId("row"));
    expect(labels().slice(1, 3)).toEqual(["Copy selection", "Copy text"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy selection" }));
    expect(writeText).toHaveBeenCalledWith("hello");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Copied to clipboard"));
  });

  it("offers no Copy selection when the selection is outside the message", async () => {
    serve(ServerMemberRoleGql.MEMBER);
    await renderMenu(ServerMemberRoleGql.MEMBER, false);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    const range = document.createRange();
    range.selectNodeContents(screen.getByTestId("other"));
    select(range);
    fireEvent.contextMenu(screen.getByTestId("row"));
    expect(labels()).not.toContain("Copy selection");
  });

  it("opens the forward dialog through onForward", async () => {
    serve(ServerMemberRoleGql.MEMBER);
    await renderMenu(ServerMemberRoleGql.MEMBER, false);
    fireEvent.click(screen.getByRole("menuitem", { name: "Forward…" }));
    expect(onForward).toHaveBeenCalledWith("msg-1", "hello");
  });

  it("opens from the keyboard with the ContextMenu key", async () => {
    serve(ServerMemberRoleGql.MEMBER);
    await renderMenu(ServerMemberRoleGql.MEMBER, false);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(menuIsOpen()).toBe(false);
    fireEvent.keyDown(screen.getByTestId("row"), { key: "ContextMenu" });
    expect(labels()[0]).toBe("Add reaction");
  });

  it("offers Reply before Reply in thread when onReply is given", async () => {
    const onReply = vi.fn();
    serve(ServerMemberRoleGql.MEMBER);
    await renderMenu(ServerMemberRoleGql.MEMBER, false, undefined, undefined, onReply);
    expect(labels().slice(1, 4)).toEqual(["Copy text", "Reply", "Reply in thread"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Reply" }));
    expect(onReply).toHaveBeenCalledWith("msg-1");
  });

  it("offers no Reply without onReply", async () => {
    serve(ServerMemberRoleGql.MEMBER);
    await renderMenu(ServerMemberRoleGql.MEMBER, false);
    expect(labels()).not.toContain("Reply");
  });

  it("drops Reply and Reply in thread in the thread panel, offers Edit there only with onEdit, and gives plugins the thread", async () => {
    pluginCommands.list = [{ id: "plugin.translate", title: "Translate" }];
    try {
      serve(ServerMemberRoleGql.MEMBER);
      await renderMenu(ServerMemberRoleGql.MEMBER, true, undefined, "thread-9", vi.fn());
      expect(labels()).toEqual([
        "Add reaction",
        "Copy text",
        "Forward…",
        "Pin message",
        "Delete message…",
        "Translate",
      ]);
      cleanup();
      await renderMenu(ServerMemberRoleGql.MEMBER, true, undefined, "thread-9", vi.fn(), vi.fn());
      expect(labels()).toEqual([
        "Add reaction",
        "Copy text",
        "Forward…",
        "Pin message",
        "Edit message",
        "Delete message…",
        "Translate",
      ]);
      fireEvent.click(screen.getByRole("menuitem", { name: "Translate" }));
      expect(dispatched).toHaveBeenCalledTimes(1);
      expect(dispatched.mock.calls[0][2]).toEqual({
        commandContext: expect.objectContaining({
          workspaceId: "ws-1",
          conversationId: "conv-1",
          selectedMessageId: "msg-1",
          threadId: "thread-9",
        }),
      });
    } finally {
      pluginCommands.list = [];
    }
  });

  it("Edit message in the thread panel calls onEdit and leaves the timeline's edit state alone", async () => {
    serve(ServerMemberRoleGql.MEMBER);
    const onEdit = vi.fn();
    await renderMenu(ServerMemberRoleGql.MEMBER, true, undefined, "thread-9", undefined, onEdit);
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit message" }));
    expect(onEdit).toHaveBeenCalledWith("msg-1");
    expect(useShellStore.getState().editingMessageId).toBeNull();
  });
});
