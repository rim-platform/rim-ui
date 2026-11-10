import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import type { CommandDefinition } from "../types";

vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: () => ({ capabilities: { deviceLocalKeybinds: true } }),
}));

const bound = vi.hoisted(() => ({
  keybinds: [] as Record<string, unknown>[],
}));

vi.mock("../api/useKeybinds", () => ({
  useResolvedKeybinds: vi.fn(() => ({ data: bound.keybinds })),
}));

const lists = vi.hoisted(() => ({ keybind: [] as CommandDefinition[] }));
const execute = vi.hoisted(() =>
  vi.fn(async (_input: { commandId: string; args?: Record<string, unknown> }) => ({
    executeCommand: { status: "SUCCESS", message: "", payload: null, followUpCommands: [] },
  })),
);

vi.mock("../api/useCommands", () => ({
  useCommands: vi.fn((surface: string) => ({
    data: surface === "KEYBIND_PICKER" ? lists.keybind : [],
  })),
  useExecuteCommandMutation: vi.fn(() => ({ mutateAsync: execute })),
  reloadCommands: vi.fn(),
}));

vi.mock("../../../shared/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { CommandArgumentType } from "../../../core/graphql/generated/schema-types";
import { KeybindProvider } from "./KeybindProvider";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useCommandArgumentsStore } from "../state/useCommandArgumentsStore";
import { useConfirmationModalStore } from "../../agent/state/confirmationModalStore";
import { useSelectedMessageStore } from "../../messages/state/useSelectedMessageStore";
import { toast } from "../../../shared/toast";

function definition(id: string, overrides: Partial<CommandDefinition> = {}): CommandDefinition {
  return {
    id,
    title: id,
    description: "",
    category: "Chat",
    sourceKind: "BUILT_IN",
    executionTarget: "BACKEND",
    requiredContext: [],
    requiredCapabilities: [],
    visibleInPalette: true,
    visibleInContextMenus: false,
    keybindCapable: true,
    dangerous: false,
    ...overrides,
  };
}

const CREATE_CHANNEL = definition("chat.create_channel", {
  arguments: [
    { name: "name", argumentType: CommandArgumentType.STRING, required: true },
    { name: "topic", argumentType: CommandArgumentType.STRING, required: false },
  ],
});

const ON_SELECTED_MESSAGE = ["workspace", "conversation", "selected_message"];

const REPORT = definition("chat.report_message", {
  title: "Report Message",
  requiredContext: ON_SELECTED_MESSAGE,
  arguments: [{ name: "reason", argumentType: CommandArgumentType.STRING, required: true }],
});

const REPLY = definition("chat.reply_to_selected_message", {
  title: "Reply To Selected Message",
  requiredContext: ON_SELECTED_MESSAGE,
  arguments: [{ name: "text", argumentType: CommandArgumentType.STRING, required: true }],
});

const MUTE = definition("notifications.mute_conversation", {
  category: "Notifications",
  arguments: [
    {
      name: "conversation_id",
      argumentType: CommandArgumentType.CONVERSATION_ID,
      required: true,
    },
    {
      name: "duration",
      argumentType: CommandArgumentType.ENUM,
      required: true,
      allowedValues: ["1h", "8h", "until_tomorrow", "forever", "until"],
    },
    { name: "until", argumentType: CommandArgumentType.STRING, required: false },
  ],
});

/** Binds Ctrl+Alt+P to `commandId` on the server, with `presetArgs` saved when given. */
function bind(commandId: string, presetArgs?: Record<string, unknown>) {
  bound.keybinds = [
    {
      id: "kb-1",
      keystroke: "Ctrl+Alt+P",
      commandId,
      context: "GLOBAL",
      source: "USER",
      scope: "USER",
      isEnabled: true,
      presetArgs: presetArgs ?? null,
    },
  ];
}

function press() {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "p", ctrlKey: true, altKey: true, bubbles: true }),
  );
}

function renderProvider() {
  render(
    <KeybindProvider>
      <div />
    </KeybindProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  lists.keybind = [CREATE_CHANNEL, REPORT, REPLY, MUTE];
  useShellStore.getState().reset();
  useWorkspaceStore.setState({ workspaceId: "ws-1" });
});

afterEach(() => {
  bound.keybinds = [];
  useCommandArgumentsStore.getState().cancel();
  useConfirmationModalStore.getState().reset();
  useSelectedMessageStore.setState({ selection: null, actions: null });
  useWorkspaceStore.setState({ workspaceId: null });
});

describe("a keybind to a server command this app has a dialog for", () => {
  it("creates the channel with the saved arguments, without the dialog", async () => {
    bind("chat.create_channel", { name: "news", topic: "Releases" });
    renderProvider();
    press();

    await vi.waitFor(() =>
      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({
          commandId: "chat.create_channel",
          args: { name: "news", topic: "Releases" },
          initiator: "KEYBIND",
        }),
      ),
    );
    expect(useShellStore.getState().showNewChannelDialog).toBe(false);
  });

  it("opens the dialog when no arguments are saved", async () => {
    bind("chat.create_channel");
    renderProvider();
    press();

    await vi.waitFor(() => expect(useShellStore.getState().showNewChannelDialog).toBe(true));
    expect(execute).not.toHaveBeenCalled();
  });

  it("asks for the required arguments the saved ones leave out", async () => {
    bind("chat.create_channel", { topic: "Releases" });
    renderProvider();
    press();

    await vi.waitFor(() =>
      expect(
        useCommandArgumentsStore.getState().request?.arguments.map((asked) => asked.name),
      ).toEqual(["name"]),
    );
    useCommandArgumentsStore.getState().submit({ name: "news" });

    await vi.waitFor(() =>
      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({ args: { topic: "Releases", name: "news" } }),
      ),
    );
    expect(useShellStore.getState().showNewChannelDialog).toBe(false);
  });
});

describe("a keybind with saved arguments to a command on the selected message", () => {
  const actions = {
    conversationId: "conv-1",
    textOf: () => "hello",
    reply: vi.fn(() => true),
    edit: vi.fn(() => true),
    report: vi.fn(() => true),
  };

  beforeEach(() => {
    useShellStore.getState().setSelectedConversationId("conv-1");
    useSelectedMessageStore.getState().setActions(actions);
    useSelectedMessageStore
      .getState()
      .select({ workspaceId: "ws-1", conversationId: "conv-1", messageId: "msg-1" });
  });

  it("asks before reporting when the server holds the report, as a macro step does", async () => {
    execute.mockResolvedValueOnce({
      executeCommand: {
        status: "CONFIRMATION_REQUIRED",
        message: "Confirm",
        payload: null,
        followUpCommands: [],
        confirmationRequired: {
          token: "tok",
          argsHash: "hash",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      },
    } as never);
    bind("chat.report_message", { reason: "spam" });
    renderProvider();
    press();

    await vi.waitFor(() =>
      expect(useConfirmationModalStore.getState().request).toMatchObject({
        commandId: "chat.report_message",
        args: { reason: "spam" },
      }),
    );
    useConfirmationModalStore.getState().reject();

    await vi.waitFor(() => expect(useConfirmationModalStore.getState().request).toBeNull());
    expect(execute).toHaveBeenCalledTimes(1);
    expect(actions.report).not.toHaveBeenCalled();
  });

  it("says why the server refused a reply in an encrypted conversation", async () => {
    execute.mockRejectedValueOnce(
      Object.assign(new Error("refused"), {
        response: {
          errors: [
            {
              message: "this conversation is encrypted",
              extensions: { code: "VALIDATION", refusal: "INVALID" },
            },
          ],
        },
      }),
    );
    bind("chat.reply_to_selected_message", { text: "On it" });
    renderProvider();
    press();

    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Reply To Selected Message: this conversation is encrypted",
      ),
    );
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        commandId: "chat.reply_to_selected_message",
        args: { text: "On it" },
        commandContext: expect.objectContaining({ selectedMessageId: "msg-1" }),
      }),
    );
    expect(actions.reply).not.toHaveBeenCalled();
  });
});

describe("a keybind that mutes until tomorrow", () => {
  const zone = process.env.TZ;

  beforeEach(() => {
    process.env.TZ = "America/New_York";
    vi.useFakeTimers({ toFake: ["Date"] });
    // 15:00 in New York.
    vi.setSystemTime(new Date("2026-11-09T20:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });

  it("ends the mute at 09:00 tomorrow in the person's timezone", async () => {
    bind("notifications.mute_conversation", { conversation_id: "c-1", duration: "until_tomorrow" });
    renderProvider();
    press();

    await vi.waitFor(() => expect(execute).toHaveBeenCalled());
    expect(execute.mock.calls[0][0].args).toEqual({
      conversation_id: "c-1",
      duration: "until",
      until: "2026-11-10T14:00:00.000Z",
    });
  });
});
