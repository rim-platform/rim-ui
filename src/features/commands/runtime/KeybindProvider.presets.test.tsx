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
  lists.keybind = [CREATE_CHANNEL, MUTE];
  useShellStore.getState().reset();
  useWorkspaceStore.setState({ workspaceId: "ws-1" });
});

afterEach(() => {
  bound.keybinds = [];
  useCommandArgumentsStore.getState().cancel();
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
