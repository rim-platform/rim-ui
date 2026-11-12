import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { serverInfoQueryClient } from "../../../test/serverInfo";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { queryClient } from "../../../core/query/queryClient";
import { useDraftStore } from "../state/useDraftStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useCommandResultStore } from "../../commands/state/useCommandResultStore";
import { useCommandArgumentsStore } from "../../commands/state/useCommandArgumentsStore";
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
const pluginCommands = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock("../../plugins/api/usePluginCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../plugins/api/usePluginCommands")>()),
  usePluginCommands: () => pluginCommands.list,
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
  definition("chat.edit_message", "Edit Message", [
    { name: "server_id", type: "WORKSPACE_ID" },
    { name: "text", type: "STRING" },
  ]),
  definition("chat.reply_to_selected_message", "Reply To Selected Message", [
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

async function renderBox(thread = false, extraCommands: object[] = []) {
  serve({ "query Commands": () => ({ commands: [...commands, ...extraCommands] }) });
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
    await new Promise((resolve) => setTimeout(resolve, 500));
  });
  return box;
}

function type(box: HTMLTextAreaElement, value: string) {
  fireEvent.change(box, { target: { value, selectionStart: value.length } });
}

function highlighted(): string {
  const row = screen
    .getAllByRole("option")
    .find((option) => option.getAttribute("aria-selected") === "true");
  return row?.textContent ?? "";
}

function press(box: HTMLTextAreaElement, key: string) {
  fireEvent.keyDown(box, { key });
}

describe("Composer — the list's commands", () => {
  beforeEach(() => {
    requestMock.mockReset();
    queryClient.clear();
    useDraftStore.getState().clearDraft("conv-1");
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useShellStore.setState({ selectedConversationId: "conv-1", showNewChannelDialog: false });
  });

  afterEach(() => {
    pluginCommands.list = [];
    useWorkspaceStore.setState({ workspaceId: null });
    useShellStore.setState({ selectedConversationId: null, showNewChannelDialog: false });
  });

  const createGroup = definition("chat.create_group", "Create Group", [
    { name: "member_ids", type: "STRING" },
  ]);
  const createChannel = definition("chat.create_channel", "Create Channel", [
    { name: "server_id", type: "WORKSPACE_ID" },
    { name: "name", type: "STRING" },
  ]);

  it("lists a server command under this app's title", async () => {
    const box = await renderBox(false, [createGroup]);
    type(box, "/chat.create_group");

    expect(await screen.findByRole("option", { name: /New Message/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Create Group/ })).not.toBeInTheDocument();
  });

  it("lists this app's own commands", async () => {
    const box = await renderBox();
    type(box, "/open home");

    expect(await screen.findByRole("option", { name: /Open Home/ })).toBeInTheDocument();
  });

  it("lists the plugins' commands", async () => {
    pluginCommands.list = [
      {
        ...definition("plugin.chat.rim.poll.create", "Create Poll", []),
        sourceKind: "PLUGIN",
        executionTarget: "DESKTOP_LOCAL",
        category: "Poll",
        contextTypes: [],
      },
    ];
    const box = await renderBox();
    type(box, "/create poll");

    expect(await screen.findByRole("option", { name: /Create Poll/ })).toBeInTheDocument();
  });

  it("sends typed arguments to the server for a command with a dialog of its own", async () => {
    const box = await renderBox(false, [createChannel]);
    type(box, "/chat.create_channel name=ops");
    await screen.findByRole("option", { name: /Create Channel/ });
    press(box, "Enter");

    await waitFor(() => expect(callsTo(requestMock, "mutation ExecuteCommand")).toHaveLength(1));
    expect(callsTo(requestMock, "mutation ExecuteCommand")[0]).toMatchObject({
      input: { commandId: "chat.create_channel", args: { name: "ops" } },
    });
    expect(useShellStore.getState().showNewChannelDialog).toBe(false);
  });

  it("opens the command's dialog when no arguments are typed", async () => {
    const box = await renderBox(false, [createChannel]);
    type(box, "/chat.create_channel");
    await screen.findByRole("option", { name: /Create Channel/ });
    press(box, "Enter");

    await waitFor(() => expect(useShellStore.getState().showNewChannelDialog).toBe(true));
    expect(callsTo(requestMock, "mutation ExecuteCommand")).toHaveLength(0);
  });
});

describe("Composer — commands", () => {
  beforeEach(() => {
    requestMock.mockReset();
    queryClient.clear();
    useDraftStore.getState().clearDraft("conv-1");
    useCommandResultStore.getState().dismiss();
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useShellStore.setState({ selectedConversationId: "conv-1" });
  });

  afterEach(() => {
    act(() => useCommandArgumentsStore.getState().cancel());
    vi.restoreAllMocks();
    useWorkspaceStore.setState({ workspaceId: null });
    useShellStore.setState({ selectedConversationId: null });
  });

  it("shows the result of a command picked with a click", async () => {
    const box = await renderBox();
    type(box, "/list_members");
    fireEvent.click(await screen.findByRole("option", { name: /List Members/ }));

    await waitFor(() =>
      expect(useCommandResultStore.getState().view?.title).toBe("List Members (1)"),
    );
    expect(useCommandResultStore.getState().view?.rows[0]).toMatchObject({ primary: "ada" });
    expect(box.value).toBe("");
    expect(callsTo(requestMock, "mutation SendMessage")).toHaveLength(0);
  });

  it("keeps the list open across spaces and runs the highlighted command on Enter", async () => {
    const box = await renderBox();
    type(box, "/List  Members");
    await screen.findByRole("option", { name: /List Members/ });
    expect(highlighted()).toContain("List Members");
    expect(screen.getByText(/Enter runs the highlighted command/)).toBeInTheDocument();
    press(box, "Enter");

    await waitFor(() => expect(useCommandResultStore.getState().view).not.toBeNull());
    expect(callsTo(requestMock, "mutation SendMessage")).toHaveLength(0);
    expect(box.value).toBe("");
  });

  it("runs the highlighted command on Tab", async () => {
    const box = await renderBox();
    type(box, "/chat.list_members");
    await screen.findByRole("option", { name: /List Members/ });
    press(box, "Tab");

    await waitFor(() => expect(useCommandResultStore.getState().view).not.toBeNull());
  });

  it("sends the line as text after Esc closes the list, and keeps it closed while editing", async () => {
    const box = await renderBox();
    type(box, "/list members");
    await screen.findByRole("option", { name: /List Members/ });
    press(box, "Escape");
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    type(box, "/list members now");
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    press(box, "Enter");

    await waitFor(() => expect(callsTo(requestMock, "mutation SendMessage")).toHaveLength(1));
    expect(callsTo(requestMock, "mutation SendMessage")[0]).toMatchObject({
      input: { text: "/list members now" },
    });
    expect(callsTo(requestMock, "mutation ExecuteCommand")).toHaveLength(0);
  });

  it("opens the list again once the line is emptied", async () => {
    const box = await renderBox();
    type(box, "/list members");
    press(box, "Escape");
    type(box, "");
    type(box, "/list");
    expect(await screen.findByRole("option", { name: /List Members/ })).toBeInTheDocument();
  });

  it("sends a slash line that matches no command as a message", async () => {
    const box = await renderBox();
    type(box, "/frobnicate now");
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    press(box, "Enter");

    await waitFor(() => expect(callsTo(requestMock, "mutation SendMessage")).toHaveLength(1));
    expect(callsTo(requestMock, "mutation ExecuteCommand")).toHaveLength(0);
  });

  it("offers a command that needs arguments with its hint, and asks for them in a form", async () => {
    const box = await renderBox();
    type(box, "/admin.b");
    const option = await screen.findByRole("option", { name: /Ban Member/ });
    expect(option).toHaveTextContent("Needs user_id.");
    press(box, "Enter");

    await waitFor(() =>
      expect(useCommandArgumentsStore.getState().request).toMatchObject({
        commandId: "admin.ban",
        arguments: [expect.objectContaining({ name: "user_id" })],
      }),
    );
    expect(box.value).toBe("");
    expect(callsTo(requestMock, "mutation ExecuteCommand")).toHaveLength(0);
    expect(callsTo(requestMock, "mutation SendMessage")).toHaveLength(0);
  });

  it("runs the highlighted command with the arguments typed after its name", async () => {
    const box = await renderBox();
    type(box, "/admin.ban user_id=u-1");
    await screen.findByRole("option", { name: /Ban Member/ });
    press(box, "Enter");

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
    await screen.findByRole("option", { name: /Post Message/ });
    press(box, "Enter");

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(expect.stringContaining("Post Message: A quoted value")),
    );
    expect(callsTo(requestMock, "mutation ExecuteCommand")).toHaveLength(0);
    expect(box.value).toBe('/chat.post_message text="open');
  });

  it("sends a command's quoted text arguments in a plain conversation", async () => {
    const box = await renderBox();
    type(box, '/chat.post_message text="hello there"');
    await screen.findByRole("option", { name: /Post Message/ });
    press(box, "Enter");

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
    await screen.findByRole("option", { name: /Post Message/ });
    press(box, "Enter");

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining("Post Message would send your text"),
      ),
    );
    expect(callsTo(requestMock, "mutation ExecuteCommand")).toHaveLength(0);
    expect(callsTo(requestMock, "mutation SendMessage")).toHaveLength(0);
  });

  it("does not send an edit's text to the server for an encrypted conversation", async () => {
    const spy = vi.spyOn(toast, "error");
    const box = await renderBox();
    serve({
      "query Conversation(": () => ({
        conversation: makeConversation({ encryptedAt: "2026-01-01T00:00:00Z" }),
      }),
    });
    type(box, '/chat.edit_message text="changed"');
    await screen.findByRole("option", { name: /Edit Message/ });
    press(box, "Enter");

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining("Edit Message would send your text"),
      ),
    );
    expect(callsTo(requestMock, "mutation ExecuteCommand")).toHaveLength(0);
  });

  it("does not offer a command that acts on a selected message the box cannot have", async () => {
    const box = await renderBox();
    type(box, "/reply");
    await act(async () => {});
    expect(
      screen.queryByRole("option", { name: /Reply To Selected Message/ }),
    ).not.toBeInTheDocument();
  });

  it("runs a pipe that starts with a known command on Enter", async () => {
    const box = await renderBox();
    serve({
      "mutation ExecuteCommand": () => ({
        executeCommand: {
          status: "SUCCESS",
          message: "",
          payload: null,
          followUpCommands: [],
          pipelineStages: [],
        },
      }),
    });
    type(box, "/chat.list_members | chat.list_members");
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    press(box, "Enter");

    await waitFor(() => expect(callsTo(requestMock, "mutation ExecuteCommand")).toHaveLength(1));
    expect(callsTo(requestMock, "mutation ExecuteCommand")[0]).toMatchObject({
      input: { isPipe: true },
    });
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
    press(box, "Enter");

    await waitFor(() => expect(spy).toHaveBeenCalledWith("Pipe failed: Unknown command: nope"));
  });

  it("sends a pipe after Esc, and one that starts with no command, as text", async () => {
    const box = await renderBox();
    type(box, "/chat.list_members | chat.list_members");
    press(box, "Escape");
    press(box, "Enter");
    await waitFor(() => expect(callsTo(requestMock, "mutation SendMessage")).toHaveLength(1));

    type(box, "/nope | x");
    press(box, "Enter");
    await waitFor(() => expect(callsTo(requestMock, "mutation SendMessage")).toHaveLength(2));
    expect(callsTo(requestMock, "mutation ExecuteCommand")).toHaveLength(0);
  });

  it("offers the same list in a thread and runs a picked command", async () => {
    const box = await renderBox(true);
    type(box, "/List Members");
    await screen.findByRole("option", { name: /List Members/ });
    press(box, "Enter");

    await waitFor(() => expect(useCommandResultStore.getState().view).not.toBeNull());
    expect(callsTo(requestMock, "mutation ReplyToMessage")).toHaveLength(0);
    expect(box.value).toBe("");
  });

  it("sends the line as a reply after Esc in a thread, and unmatched text too", async () => {
    const box = await renderBox(true);
    type(box, "/List Members");
    await screen.findByRole("option", { name: /List Members/ });
    press(box, "Escape");
    press(box, "Enter");
    await waitFor(() => expect(callsTo(requestMock, "mutation ReplyToMessage")).toHaveLength(1));

    type(box, "/frobnicate now");
    press(box, "Enter");
    await waitFor(() => expect(callsTo(requestMock, "mutation ReplyToMessage")).toHaveLength(2));
    expect(callsTo(requestMock, "mutation ExecuteCommand")).toHaveLength(0);
  });
});
