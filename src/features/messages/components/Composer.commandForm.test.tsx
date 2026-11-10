import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";

import { serverInfoQueryClient } from "../../../test/serverInfo";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { queryClient } from "../../../core/query/queryClient";
import { useDraftStore } from "../state/useDraftStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useCommandArgumentsStore } from "../../commands/state/useCommandArgumentsStore";
import { useCommandStore } from "../../commands/state/useCommandStore";
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
vi.mock("../../plugins/api/usePluginCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../plugins/api/usePluginCommands")>()),
  usePluginCommands: () => [],
}));
vi.mock("../hooks/useTypingIndicator", () => ({
  useTypingIndicator: () => ({ handleKeystroke: () => {}, markSent: () => {} }),
}));
vi.mock("../../../shared/ui/EmojiPicker", () => ({
  EmojiPicker: ({ onSelect }: { onSelect: (emoji: string) => void }) => (
    <div role="dialog" aria-label="Emoji picker">
      <button type="button" onClick={() => onSelect("🎉")}>
        Tada
      </button>
    </div>
  ),
}));
vi.mock("../../commands/components/paletteTargets", async (importOriginal) => {
  const targets = {
    items: [
      { id: "conv-1", serverId: "ws-1", label: "#general" },
      { id: "conv-2", serverId: "ws-1", label: "#ops" },
    ],
    isPending: false,
  };
  return {
    ...(await importOriginal<typeof import("../../commands/components/paletteTargets")>()),
    useChannelTargets: () => targets,
    useOwnConversationTargets: () => targets,
  };
});

import { Composer, ThreadComposer } from "./Composer";
import { CommandArgumentsDialog } from "../../commands/components/CommandArgumentsDialog";
import { toast } from "../../../shared/toast";

interface ArgumentSpec {
  name: string;
  type: string;
  required?: boolean;
  allowedValues?: string[];
  defaultValue?: unknown;
  title?: string;
}

function definition(id: string, title: string, args: ArgumentSpec[], executionTarget = "BACKEND") {
  return {
    id,
    title,
    description: `${title}.`,
    category: "Test",
    sourceKind: "BUILT_IN",
    executionTarget,
    requiredContext: [],
    requiredCapabilities: [],
    visibleInPalette: true,
    visibleInContextMenus: false,
    keybindCapable: false,
    dangerous: false,
    arguments: args.map((a) => ({
      name: a.name,
      title: a.title ?? null,
      argumentType: a.type,
      required: a.required ?? true,
      allowedValues: a.allowedValues ?? null,
      defaultValue: a.defaultValue ?? null,
    })),
  };
}

const WORKSPACE = { name: "server_id", type: "WORKSPACE_ID" };
const CONVERSATION = { name: "conversation_id", type: "CONVERSATION_ID" };

const commands = [
  definition("chat.list_members", "List Members", [WORKSPACE]),
  definition("state.set", "Set State", [
    WORKSPACE,
    { name: "key", type: "STRING", title: "Key" },
    { name: "value", type: "STRING", title: "Value" },
    {
      name: "scope",
      type: "STRING",
      required: false,
      allowedValues: ["server", "user"],
      defaultValue: "server",
    },
    { name: "ttl", type: "INTEGER", required: false },
  ]),
  definition("admin.ban", "Ban Member", [
    WORKSPACE,
    { name: "user_id", type: "USER_ID", title: "Member" },
    { name: "reason", type: "STRING", required: false },
  ]),
  definition("admin.timeout", "Timeout Member", [
    WORKSPACE,
    { name: "user_id", type: "USER_ID", title: "Member" },
    { name: "minutes", type: "INTEGER" },
  ]),
  definition("notifications.dnd", "Pause Notifications", [
    { name: "mode", type: "ENUM", allowedValues: ["on", "off", "until"] },
    { name: "until", type: "STRING", required: false },
    { name: "minutes", type: "INTEGER", required: false },
  ]),
  definition("chat.toggle_reaction", "Toggle Reaction", [
    WORKSPACE,
    CONVERSATION,
    { name: "message_id", type: "MESSAGE_ID" },
    { name: "emoji", type: "STRING", title: "Emoji" },
  ]),
  definition("chat.set_slow_mode", "Set Slow Mode", [
    WORKSPACE,
    { ...CONVERSATION, title: "Channel" },
    { name: "seconds", type: "INTEGER", title: "Seconds" },
  ]),
  definition("chat.post_message", "Post Message", [
    WORKSPACE,
    CONVERSATION,
    { name: "text", type: "STRING", title: "Text" },
  ]),
  definition("workspace.navigate_to_channel", "Go to Channel", [CONVERSATION], "DESKTOP_LOCAL"),
];

const done = {
  executeCommand: { status: "SUCCESS", message: "Done.", payload: null, followUpCommands: [] },
};

function serve(encrypted = false) {
  routeRequests(requestMock, {
    ...baseReadHandlers,
    "query Conversation(": () => ({
      conversation: makeConversation(encrypted ? { encryptedAt: "2026-01-01T00:00:00Z" } : {}),
    }),
    "query Commands": () => ({ commands }),
    "query WorkspaceStateList": () => ({
      workspaceStateList: [
        {
          id: "s-1",
          serverId: "ws-1",
          key: "counter",
          value: 41,
          scope: "SERVER",
          userId: null,
          version: 1,
          expiresAt: null,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ],
    }),
    "mutation ExecuteCommand": () => done,
    "mutation SendMessage": () => ({ sendMessage: { id: "m-1" } }),
  });
}

async function renderBox({ thread = false, encrypted = false } = {}) {
  serve(encrypted);
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
      <CommandArgumentsDialog />
    </QueryClientProvider>,
  );
  const box = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
  });
  return box;
}

/** Types `line` in the box and picks the command the list highlights with Enter. */
async function pick(box: HTMLTextAreaElement, line: string, option: RegExp) {
  fireEvent.change(box, { target: { value: line, selectionStart: line.length } });
  await screen.findByRole("option", { name: option });
  fireEvent.keyDown(box, { key: "Enter" });
}

/** The argument form, once it is open. */
async function form(title: string) {
  return within(await screen.findByRole("dialog", { name: title }));
}

function executed() {
  return callsTo(requestMock, "mutation ExecuteCommand");
}

describe("Composer — a picked command's argument form", () => {
  beforeEach(() => {
    requestMock.mockReset();
    queryClient.clear();
    useDraftStore.getState().clearDraft("conv-1");
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useShellStore.setState({ selectedConversationId: "conv-1" });
  });

  afterEach(() => {
    act(() => useCommandArgumentsStore.getState().cancel());
    useCommandStore.getState().closeCommandPalette();
    vi.restoreAllMocks();
    useWorkspaceStore.setState({ workspaceId: null });
    useShellStore.setState({ selectedConversationId: null });
  });

  it("opens the palette's form for a command picked without arguments", async () => {
    const user = userEvent.setup();
    const box = await renderBox();
    await pick(box, "/state.set", /Set State/);

    const dialog = await form("Set State");
    const request = useCommandArgumentsStore.getState().request;
    expect(request?.commandId).toBe("state.set");
    expect(request?.arguments.map((a) => a.name)).toEqual(["key", "value"]);
    expect(request?.moreArguments?.map((a) => a.name)).toEqual(["scope", "ttl"]);
    expect(request?.conversationId).toBe("conv-1");
    expect(dialog.getByRole("button", { name: "More options" })).toBeInTheDocument();
    expect(box.value).toBe("");

    // The key field lists the workspace's keys with their values.
    await user.type(dialog.getByLabelText("Key"), "counter");
    await waitFor(() =>
      expect(dialog.getByText((_, node) => node?.textContent === "Now: 41")).toBeInTheDocument(),
    );
    await user.type(dialog.getByLabelText("Value"), "42");
    await user.click(dialog.getByRole("button", { name: "Run" }));

    await waitFor(() => expect(executed()).toHaveLength(1));
    expect(executed()[0]).toMatchObject({
      input: { commandId: "state.set", args: { key: "counter", value: "42" } },
    });
  });

  it("runs a command that needs no arguments at once", async () => {
    const box = await renderBox();
    await pick(box, "/chat.list_members", /List Members/);

    await waitFor(() => expect(executed()).toHaveLength(1));
    expect(useCommandArgumentsStore.getState().request).toBeNull();
  });

  it("runs with typed arguments that are complete, asking nothing", async () => {
    const box = await renderBox();
    await pick(box, "/state.set key=counter value=7", /Set State/);

    await waitFor(() => expect(executed()).toHaveLength(1));
    expect(executed()[0]).toMatchObject({
      input: { commandId: "state.set", args: { key: "counter", value: "7" } },
    });
    expect(useCommandArgumentsStore.getState().request).toBeNull();
  });

  it("opens the form with what was typed when a required argument is left out", async () => {
    const user = userEvent.setup();
    const box = await renderBox();
    await pick(box, "/state.set key=counter", /Set State/);

    const dialog = await form("Set State");
    expect(dialog.getByLabelText("Key")).toHaveValue("counter");
    // The typed key gives the value field its current value.
    await waitFor(() =>
      expect(dialog.getByText((_, node) => node?.textContent === "Now: 41")).toBeInTheDocument(),
    );
    expect(executed()).toHaveLength(0);
    await user.type(dialog.getByLabelText("Value"), "42");
    await user.click(dialog.getByRole("button", { name: "Run" }));

    await waitFor(() => expect(executed()).toHaveLength(1));
    expect(executed()[0]).toMatchObject({
      input: { commandId: "state.set", args: { key: "counter", value: "42" } },
    });
  });

  it("opens the form on a typed value its field cannot take, saying why", async () => {
    const user = userEvent.setup();
    const box = await renderBox();
    await pick(box, "/chat.set_slow_mode seconds=soon", /Set Slow Mode/);

    const dialog = await form("Set Slow Mode");
    expect(dialog.getByLabelText("Seconds")).toHaveValue("soon");
    expect(dialog.getByText("Enter a whole number")).toBeInTheDocument();
    expect(executed()).toHaveLength(0);
    await user.clear(dialog.getByLabelText("Seconds"));
    await user.type(dialog.getByLabelText("Seconds"), "30");
    await user.click(dialog.getByRole("button", { name: "Run" }));

    await waitFor(() => expect(executed()).toHaveLength(1));
    expect(executed()[0]).toMatchObject({
      input: { commandId: "chat.set_slow_mode", args: { seconds: 30 } },
    });
  });

  it("runs nothing when the form is cancelled", async () => {
    const user = userEvent.setup();
    const box = await renderBox();
    await pick(box, "/state.set", /Set State/);
    const dialog = await form("Set State");
    await user.click(dialog.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(useCommandArgumentsStore.getState().request).toBeNull());
    expect(executed()).toHaveLength(0);
    expect(callsTo(requestMock, "mutation SendMessage")).toHaveLength(0);
  });

  it("asks for a member with the member picker", async () => {
    const user = userEvent.setup();
    const box = await renderBox();
    await pick(box, "/admin.ban", /Ban Member/);

    const dialog = await form("Ban Member");
    await user.click(dialog.getByLabelText("Member"));
    await user.keyboard("alice");
    await user.click(await screen.findByRole("option", { name: /Alice/ }));
    await user.click(dialog.getByRole("button", { name: "Run" }));

    await waitFor(() => expect(executed()).toHaveLength(1));
    expect(executed()[0]).toMatchObject({
      input: { commandId: "admin.ban", args: { user_id: "u-alice" } },
    });
  });

  it("shows a typed conversation in the conversation picker", async () => {
    const box = await renderBox();
    await pick(box, "/chat.set_slow_mode conversation_id=conv-2", /Set Slow Mode/);

    const dialog = await form("Set Slow Mode");
    const channel = dialog.getByLabelText("Channel");
    expect(channel).toHaveValue("conv-2");
    expect(within(channel).getByRole("option", { name: "#ops" })).toBeInTheDocument();
    expect(dialog.getByLabelText("Seconds")).toHaveValue("");
  });

  it("opens the palette's channel list for a command that picks its target there", async () => {
    const box = await renderBox();
    await pick(box, "/workspace.navigate_to_channel", /Go to Channel/);

    await waitFor(() =>
      expect(useCommandStore.getState().targetPicker).toMatchObject({
        commandId: "workspace.navigate_to_channel",
        kind: "channel",
      }),
    );
    expect(useCommandStore.getState().isCommandPaletteOpen).toBe(true);
    expect(useCommandArgumentsStore.getState().request).toBeNull();
  });

  it("asks when a pause ends with the time picker", async () => {
    const user = userEvent.setup();
    const box = await renderBox();
    await pick(box, "/notifications.dnd", /Pause Notifications/);

    const dialog = await form("Pause Notifications");
    const pause = dialog.getByLabelText("Pause");
    expect(within(pause).getByRole("option", { name: "Until a time" })).toBeInTheDocument();
    await user.selectOptions(pause, "Until I turn it back on");
    await user.click(dialog.getByRole("button", { name: "Run" }));

    await waitFor(() => expect(executed()).toHaveLength(1));
    expect(executed()[0]).toMatchObject({
      input: { commandId: "notifications.dnd", args: { mode: "on" } },
    });
  });

  it("asks how long a timeout lasts, with the typed member kept", async () => {
    const box = await renderBox();
    await pick(box, "/admin.timeout user_id=u-bob", /Timeout Member/);

    const dialog = await form("Timeout Member");
    expect(dialog.getByLabelText("How long")).toBeInTheDocument();
    expect(useCommandArgumentsStore.getState().request?.startValues).toEqual({
      user_id: "u-bob",
    });
  });

  it("asks for an emoji with the emoji picker", async () => {
    const user = userEvent.setup();
    const box = await renderBox();
    await pick(box, "/chat.toggle_reaction message_id=m-9", /Toggle Reaction/);

    const dialog = await form("Toggle Reaction");
    await user.click(dialog.getByRole("button", { name: "Choose an emoji" }));
    await user.click(await screen.findByRole("button", { name: "Tada" }));
    await user.click(dialog.getByRole("button", { name: "Run" }));

    await waitFor(() => expect(executed()).toHaveLength(1));
    expect(executed()[0]).toMatchObject({
      input: { commandId: "chat.toggle_reaction", args: { message_id: "m-9", emoji: "🎉" } },
    });
  });

  it("opens the form in a thread, in the thread's conversation", async () => {
    const box = await renderBox({ thread: true });
    await pick(box, "/state.set", /Set State/);

    await form("Set State");
    expect(useCommandArgumentsStore.getState().request?.conversationId).toBe("conv-1");
    expect(callsTo(requestMock, "mutation ReplyToMessage")).toHaveLength(0);
  });

  it("leaves a built-in text command's name to finish, opening no form", async () => {
    const box = await renderBox();
    fireEvent.change(box, { target: { value: "/mac", selectionStart: 4 } });
    fireEvent.click(await screen.findByRole("option", { name: /\/macro/ }));

    expect(box.value).toBe("/macro ");
    expect(useCommandArgumentsStore.getState().request).toBeNull();
    expect(executed()).toHaveLength(0);
  });

  it("asks nothing for a command that would send text to an encrypted conversation", async () => {
    const spy = vi.spyOn(toast, "error");
    const box = await renderBox({ encrypted: true });
    await pick(box, "/chat.post_message", /Post Message/);

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining("Post Message would send your text"),
      ),
    );
    expect(useCommandArgumentsStore.getState().request).toBeNull();
    expect(executed()).toHaveLength(0);
  });
});
