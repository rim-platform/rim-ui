import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import type { CommandDefinition } from "../types";

vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: () => ({ capabilities: { deviceLocalKeybinds: true } }),
}));

vi.mock("../api/useKeybinds", () => ({
  useResolvedKeybinds: vi.fn(() => ({ data: [] })),
}));

const lists = vi.hoisted(() => ({
  keybind: undefined as CommandDefinition[] | undefined,
  palette: undefined as CommandDefinition[] | undefined,
}));
const execute = vi.hoisted(() =>
  vi.fn(async () => ({
    executeCommand: { status: "SUCCESS", message: "", payload: null, followUpCommands: [] },
  })),
);

vi.mock("../api/useCommands", () => ({
  useCommands: vi.fn((surface: string) => ({
    data: surface === "KEYBIND_PICKER" ? lists.keybind : lists.palette,
  })),
  useExecuteCommandMutation: vi.fn(() => ({ mutateAsync: execute })),
  reloadCommands: vi.fn(),
}));

vi.mock("../../../shared/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { KeybindProvider } from "./KeybindProvider";
import { keybindCommand } from "./keybindCommand";
import { toast } from "../../../shared/toast";
import { useDeviceKeybindStore } from "../state/useDeviceKeybindStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import {
  useSelectedMessageStore,
  type SelectedMessageActions,
} from "../../messages/state/useSelectedMessageStore";
import { LOCAL_COMMAND_NAMESPACES } from "./localCommands";

function definition(
  id: string,
  title: string,
  overrides: Partial<CommandDefinition> = {},
): CommandDefinition {
  return {
    id,
    title,
    description: "",
    category: "Chat",
    sourceKind: "BUILT_IN",
    executionTarget: "BACKEND",
    requiredContext: [],
    requiredCapabilities: [],
    visibleInPalette: false,
    visibleInContextMenus: true,
    keybindCapable: true,
    dangerous: false,
    ...overrides,
  };
}

const ON_SELECTED_MESSAGE = ["workspace", "conversation", "selected_message"];

/** The server's keybind-capable commands on the selected message, as the registry declares them. */
const MESSAGE_COMMANDS = [
  definition("chat.delete_message", "Delete Message", {
    requiredContext: ON_SELECTED_MESSAGE,
    dangerous: true,
  }),
  definition("chat.edit_message", "Edit Message", {
    requiredContext: ON_SELECTED_MESSAGE,
    arguments: [{ name: "text", argumentType: "STRING" as never, required: true }],
  }),
  definition("chat.report_message", "Report Message", {
    requiredContext: ON_SELECTED_MESSAGE,
    arguments: [{ name: "reason", argumentType: "STRING" as never, required: true }],
  }),
  definition("chat.reply_to_selected_message", "Reply To Selected Message", {
    requiredContext: ON_SELECTED_MESSAGE,
    visibleInPalette: true,
    arguments: [{ name: "text", argumentType: "STRING" as never, required: true }],
  }),
];

function bind(commandId: string) {
  useDeviceKeybindStore.setState({ keybinds: [] });
  useDeviceKeybindStore.getState().add({ keystroke: "Ctrl+Alt+P", commandId, context: "GLOBAL" });
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

function fakeActions(): SelectedMessageActions {
  return {
    conversationId: "conv-1",
    textOf: () => "hello",
    reply: vi.fn(() => true),
    edit: vi.fn(() => true),
    report: vi.fn(() => true),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  lists.keybind = MESSAGE_COMMANDS;
  lists.palette = [];
  useShellStore.getState().reset();
  useWorkspaceStore.setState({ workspaceId: "ws-1" });
  useShellStore.getState().setSelectedConversationId("conv-1");
});

afterEach(() => {
  useSelectedMessageStore.setState({ selection: null, actions: null });
  useWorkspaceStore.setState({ workspaceId: null });
  useDeviceKeybindStore.setState({ keybinds: [] });
});

describe("keybindCommand", () => {
  const keybindOnly = definition("chat.scroll_to_top", "Scroll to Top", {
    executionTarget: "DESKTOP_LOCAL",
  });
  const paletteOnly = definition("chat.list_channels", "List Channels", { keybindCapable: false });

  it("looks in the keybind list, then the palette list, then this app's own commands", () => {
    expect(keybindCommand("chat.scroll_to_top", [keybindOnly], [])).toBe(keybindOnly);
    expect(keybindCommand("chat.list_channels", [keybindOnly], [paletteOnly])).toBe(paletteOnly);
    expect(keybindCommand("workspace.open_home", [], [])).toMatchObject({
      title: "Open Home",
      executionTarget: "DESKTOP_LOCAL",
    });
  });

  it("prefers the keybind list's definition over the palette's", () => {
    const fromPalette = { ...keybindOnly, title: "Other" };
    expect(keybindCommand("chat.scroll_to_top", [keybindOnly], [fromPalette])).toBe(keybindOnly);
  });

  it("shows this app's title for a server command", () => {
    const createGroup = definition("chat.create_group", "Create Group");
    expect(keybindCommand("chat.create_group", [createGroup], [])?.title).toBe("New Message");
  });

  it("stands in for a command while either list is loading, its target taken from the namespace", () => {
    for (const prefix of LOCAL_COMMAND_NAMESPACES) {
      expect(keybindCommand(`${prefix}later`, undefined, [])?.executionTarget).toBe(
        "DESKTOP_LOCAL",
      );
    }
    expect(keybindCommand("notifications.dnd", [], undefined)).toMatchObject({
      executionTarget: "BACKEND",
      title: "notifications.dnd",
    });
  });

  it("knows no command the loaded lists do not have", () => {
    expect(keybindCommand("chat.gone", [], [])).toBeNull();
  });

  it("stands in for a plugin's command, panel and settings once the lists have loaded", () => {
    expect(keybindCommand("plugin.chat.rim.poll.create", [], [])).toMatchObject({
      sourceKind: "PLUGIN",
    });
    expect(keybindCommand("workspace.open_plugin_panel.chat.rim.poll/main", [], [])).not.toBeNull();
    expect(keybindCommand("workspace.open_plugin_settings.chat.rim.poll", [], [])).not.toBeNull();
  });
});

describe("KeybindProvider with an unknown command", () => {
  it("says the command is not available once the lists have loaded, and runs nothing", () => {
    bind("chat.gone");
    renderProvider();
    press();

    expect(toast.error).toHaveBeenCalledWith("chat.gone: This command isn't available here");
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("KeybindProvider with keybinds to commands on the selected message", () => {
  it("deletes the selected message through the server", async () => {
    useSelectedMessageStore
      .getState()
      .select({ workspaceId: "ws-1", conversationId: "conv-1", messageId: "msg-1" });
    bind("chat.delete_message");
    renderProvider();
    press();

    await vi.waitFor(() =>
      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({
          commandId: "chat.delete_message",
          commandContext: expect.objectContaining({ selectedMessageId: "msg-1" }),
        }),
      ),
    );
  });

  it.each([
    ["chat.edit_message", "edit"],
    ["chat.report_message", "report"],
    ["chat.reply_to_selected_message", "reply"],
  ] as const)("runs %s on the selected message", async (id, action) => {
    const actions = fakeActions();
    useSelectedMessageStore.getState().setActions(actions);
    useSelectedMessageStore
      .getState()
      .select({ workspaceId: "ws-1", conversationId: "conv-1", messageId: "msg-1" });
    bind(id);
    renderProvider();
    press();

    await vi.waitFor(() => expect(actions[action]).toHaveBeenCalledWith("msg-1"));
    expect(execute).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("asks for a message before deleting when none is selected", async () => {
    bind("chat.delete_message");
    renderProvider();
    press();

    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Delete Message: Select a message first"),
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it.each(["chat.edit_message", "chat.report_message", "chat.reply_to_selected_message"])(
    "asks for a message before %s when none is selected",
    async (id) => {
      useSelectedMessageStore.getState().setActions(fakeActions());
      bind(id);
      renderProvider();
      press();

      await vi.waitFor(() => expect(toast.info).toHaveBeenCalledWith("Select a message first"));
      expect(execute).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalledWith(expect.stringContaining("No local handler"));
    },
  );
});
