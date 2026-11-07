import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { serverInfoQueryClient } from "../../../test/serverInfo";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { queryClient } from "../../../core/query/queryClient";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useCommandResultStore } from "../../commands/state/useCommandResultStore";
import {
  baseReadHandlers,
  callsTo,
  makeConversation,
  routeRequests,
} from "../../conversations/__fixtures__/conversations";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));
vi.mock("../hooks/useTypingIndicator", () => ({
  useTypingIndicator: () => ({ handleKeystroke: () => {}, markSent: () => {} }),
}));

import { Composer, ThreadComposer } from "./Composer";
import { toast } from "../../../shared/toast";

function definition(id: string, title: string, args: { name: string; type: string }[]) {
  return {
    id,
    title,
    description: `${title}.`,
    category: "Chat",
    sourceKind: "BUILT_IN",
    executionTarget: "BACKEND",
    requiredContext: [],
    requiredCapabilities: [],
    visibleInPalette: true,
    visibleInContextMenus: false,
    keybindCapable: false,
    dangerous: false,
    arguments: args.map((a) => ({ name: a.name, argumentType: a.type, required: true })),
  };
}

const commands = [
  definition("chat.list_members", "List Members", [{ name: "server_id", type: "WORKSPACE_ID" }]),
  definition("chat.post_message", "Post Message", [
    { name: "server_id", type: "WORKSPACE_ID" },
    { name: "conversation_id", type: "CONVERSATION_ID" },
    { name: "text", type: "STRING" },
  ]),
  definition("admin.ban", "Ban Member", [
    { name: "server_id", type: "WORKSPACE_ID" },
    { name: "user_id", type: "USER_ID" },
  ]),
];

const membersResult = {
  executeCommand: {
    status: "SUCCESS",
    message: "1 member found.",
    payload: { members: [{ username: "ada", role: "OWNER" }] },
    followUpCommands: [],
  },
};

function serve(extra: Record<string, (vars: Record<string, unknown>) => unknown> = {}) {
  routeRequests(requestMock, {
    ...baseReadHandlers,
    "query Conversation(": () => ({ conversation: makeConversation() }),
    "query Commands": () => ({ commands }),
    "mutation ExecuteCommand": () => membersResult,
    "mutation SendMessage": () => ({ sendMessage: { id: "m-1" } }),
    "mutation ReplyToMessage": () => ({ replyToMessage: { id: "m-2" } }),
    ...extra,
  });
}

async function renderBox(thread = false) {
  serve();
  render(
    <QueryClientProvider client={serverInfoQueryClient()}>
      {thread ? (
        <ThreadComposer
          workspaceId="ws-1"
          conversationId="conv-1"
          thread={{ rootMessageId: "root-1", threadId: "t-1" }}
        />
      ) : (
        <Composer workspaceId="ws-1" conversationId="conv-1" />
      )}
    </QueryClientProvider>,
  );
  const box = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
  return box;
}

function type(box: HTMLTextAreaElement, value: string) {
  fireEvent.change(box, { target: { value, selectionStart: value.length } });
}

describe("Composer — commands", () => {
  beforeEach(() => {
    requestMock.mockReset();
    queryClient.clear();
    useCommandResultStore.getState().dismiss();
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useShellStore.setState({ selectedConversationId: "conv-1" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useWorkspaceStore.setState({ workspaceId: null });
    useShellStore.setState({ selectedConversationId: null });
  });

  it("shows the result of a command picked from the list", async () => {
    const box = await renderBox();
    type(box, "/list_members");
    fireEvent.click(await screen.findByRole("option", { name: /List Members/ }));

    await waitFor(() =>
      expect(useCommandResultStore.getState().view?.title).toBe("List Members (1)"),
    );
    expect(useCommandResultStore.getState().view?.rows[0]).toMatchObject({ primary: "ada" });
    expect(box.value).toBe("");
    expect(callsTo(requestMock, "mutation ExecuteCommand")).toHaveLength(1);
    expect(callsTo(requestMock, "mutation SendMessage")).toHaveLength(0);
  });

  it("runs a line that is a command title instead of sending it", async () => {
    const box = await renderBox();
    type(box, "/List  Members");
    fireEvent.keyDown(box, { key: "Enter" });

    await waitFor(() => expect(useCommandResultStore.getState().view).not.toBeNull());
    expect(callsTo(requestMock, "mutation SendMessage")).toHaveLength(0);
    expect(box.value).toBe("");
  });

  it("runs a line that is a command id instead of sending it", async () => {
    const box = await renderBox();
    type(box, "/chat.list_members");
    // The suggestion list is open for the id; dismissing it sends the line as typed.
    fireEvent.keyDown(box, { key: "Escape" });
    fireEvent.keyDown(box, { key: "Enter" });

    await waitFor(() => expect(useCommandResultStore.getState().view).not.toBeNull());
    expect(callsTo(requestMock, "mutation SendMessage")).toHaveLength(0);
  });

  it("sends a slash line that names no command as a message", async () => {
    const box = await renderBox();
    type(box, "/frobnicate now");
    fireEvent.keyDown(box, { key: "Enter" });

    await waitFor(() => expect(callsTo(requestMock, "mutation SendMessage")).toHaveLength(1));
    expect(callsTo(requestMock, "mutation ExecuteCommand")).toHaveLength(0);
  });

  it("offers a command that needs arguments, and inserts its form when picked", async () => {
    const box = await renderBox();
    type(box, "/admin.ban");
    const option = await screen.findByRole("option", { name: /Ban Member/ });
    expect(option).toHaveTextContent("Needs user_id.");
    fireEvent.click(option);

    expect(box.value).toBe("/admin.ban user_id=");
    expect(callsTo(requestMock, "mutation ExecuteCommand")).toHaveLength(0);
  });

  it("says what a typed command lacks, with the form to type, and keeps the text", async () => {
    const spy = vi.spyOn(toast, "error");
    const box = await renderBox();
    type(box, "/Ban Member");
    fireEvent.keyDown(box, { key: "Escape" });
    fireEvent.keyDown(box, { key: "Enter" });

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith("Ban Member needs user_id. Type /admin.ban user_id=..."),
    );
    expect(callsTo(requestMock, "mutation ExecuteCommand")).toHaveLength(0);
    expect(callsTo(requestMock, "mutation SendMessage")).toHaveLength(0);
    expect(box.value).toBe("/Ban Member");
  });

  it("runs a typed command with its arguments instead of sending the line", async () => {
    const box = await renderBox();
    type(box, "/admin.ban user_id=u-1");
    fireEvent.keyDown(box, { key: "Enter" });

    await waitFor(() => expect(callsTo(requestMock, "mutation ExecuteCommand")).toHaveLength(1));
    expect(callsTo(requestMock, "mutation ExecuteCommand")[0]).toMatchObject({
      input: { commandId: "admin.ban", args: { user_id: "u-1" } },
    });
    expect(callsTo(requestMock, "mutation SendMessage")).toHaveLength(0);
    expect(box.value).toBe("");
  });

  it("keeps a line whose arguments cannot be read", async () => {
    const spy = vi.spyOn(toast, "error");
    const box = await renderBox();
    type(box, '/chat.post_message text="open');
    fireEvent.keyDown(box, { key: "Enter" });

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(expect.stringContaining("Post Message: A quoted value")),
    );
    expect(callsTo(requestMock, "mutation ExecuteCommand")).toHaveLength(0);
    expect(box.value).toBe('/chat.post_message text="open');
  });

  it("sends text-carrying commands in a plain conversation", async () => {
    const box = await renderBox();
    type(box, '/chat.post_message text="hello there"');
    fireEvent.keyDown(box, { key: "Enter" });

    await waitFor(() => expect(callsTo(requestMock, "mutation ExecuteCommand")).toHaveLength(1));
    expect(callsTo(requestMock, "mutation ExecuteCommand")[0]).toMatchObject({
      input: { commandId: "chat.post_message", args: { text: "hello there" } },
    });
  });

  it("does not send a command's message text to the server for an encrypted conversation", async () => {
    const spy = vi.spyOn(toast, "error");
    const box = await renderBox();
    serve({
      "query Conversation(": () => ({
        conversation: makeConversation({ encryptedAt: "2026-01-01T00:00:00Z" }),
      }),
    });
    type(box, '/chat.post_message text="a secret"');
    fireEvent.keyDown(box, { key: "Enter" });

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining("Post Message would send your text"),
      ),
    );
    expect(callsTo(requestMock, "mutation ExecuteCommand")).toHaveLength(0);
    expect(callsTo(requestMock, "mutation SendMessage")).toHaveLength(0);
  });

  it("reports a pipe the server refuses", async () => {
    const spy = vi.spyOn(toast, "error");
    const box = await renderBox();
    serve({
      "mutation ExecuteCommand": () => ({
        executeCommand: {
          status: "ERROR",
          message: "Unknown command: nope",
          payload: null,
          followUpCommands: [],
          pipelineStages: [],
        },
      }),
    });
    type(box, "/chat.list_members | nope");
    fireEvent.keyDown(box, { key: "Enter" });

    await waitFor(() => expect(spy).toHaveBeenCalledWith("Pipe failed: Unknown command: nope"));
    const [call] = callsTo(requestMock, "mutation ExecuteCommand");
    expect(call).toMatchObject({ input: { isPipe: true } });
  });

  it("runs a command line typed in a thread instead of replying with it", async () => {
    const box = await renderBox(true);
    type(box, "/List Members");
    fireEvent.keyDown(box, { key: "Enter" });

    await waitFor(() => expect(useCommandResultStore.getState().view).not.toBeNull());
    expect(callsTo(requestMock, "mutation ReplyToMessage")).toHaveLength(0);
    expect(box.value).toBe("");
  });

  it("sends other text typed in a thread as a reply", async () => {
    const box = await renderBox(true);
    type(box, "/frobnicate now");
    fireEvent.keyDown(box, { key: "Enter" });

    await waitFor(() => expect(callsTo(requestMock, "mutation ReplyToMessage")).toHaveLength(1));
    expect(callsTo(requestMock, "mutation ExecuteCommand")).toHaveLength(0);
  });
});
