import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../shared/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import { CommandArgumentType } from "../../../core/graphql/generated/schema-types";
import { useConfirmationModalStore } from "../../agent/state/confirmationModalStore";
import { useCommandArgumentsStore } from "../state/useCommandArgumentsStore";
import type { CommandArgumentInfo, CommandDefinition, CommandResult } from "../types";
import { dispatchCommand } from "./commandDispatcher";

function argument(
  name: string,
  argumentType: CommandArgumentType,
  required = true,
): CommandArgumentInfo {
  return { name, title: name, description: "", argumentType, required };
}

function command(id: string, overrides: Partial<CommandDefinition> = {}): CommandDefinition {
  return {
    id,
    title: id,
    description: "",
    category: "Moderation",
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

const TIMEOUT = command("admin.timeout", {
  title: "Timeout Member",
  arguments: [
    argument("server_id", CommandArgumentType.WORKSPACE_ID),
    argument("user_id", CommandArgumentType.USER_ID),
    argument("minutes", CommandArgumentType.INTEGER),
    argument("reason", CommandArgumentType.STRING, false),
  ],
});

const DND = command("notifications.dnd", {
  title: "Do Not Disturb",
  arguments: [
    argument("server_id", CommandArgumentType.WORKSPACE_ID),
    { ...argument("mode", CommandArgumentType.ENUM), allowedValues: ["on", "off", "until"] },
    argument("minutes", CommandArgumentType.INTEGER, false),
  ],
});

const BAN = command("admin.ban", {
  title: "Ban Member",
  arguments: [
    argument("server_id", CommandArgumentType.WORKSPACE_ID),
    argument("user_id", CommandArgumentType.USER_ID),
    argument("reason", CommandArgumentType.STRING, false),
    argument("expires_at", CommandArgumentType.STRING, false),
    argument("minutes", CommandArgumentType.INTEGER, false),
    argument("message_id", CommandArgumentType.MESSAGE_ID, false),
  ],
});

const PIN = command("chat.pin_message", {
  title: "Pin Message",
  arguments: [
    argument("server_id", CommandArgumentType.WORKSPACE_ID),
    argument("message_id", CommandArgumentType.MESSAGE_ID),
  ],
});

const SUCCESS: CommandResult = {
  status: "SUCCESS",
  message: "Done",
  payload: null,
  followUpCommands: [],
};

const executeBackend = vi.fn(async (_input: { args?: Record<string, unknown> }) => ({
  executeCommand: SUCCESS,
}));

const CONTEXT = { workspaceId: "ws-1", conversationId: "conv-1" };

/** The names of the optional arguments the open form folds under "More options". */
function moreNames(): string[] | undefined {
  return useCommandArgumentsStore.getState().request?.moreArguments?.map((a) => a.name);
}

/** The names of the arguments the open form asks for. */
function askedNames(): string[] | undefined {
  return useCommandArgumentsStore.getState().request?.arguments.map((a) => a.name);
}

beforeEach(() => {
  executeBackend.mockClear();
  executeBackend.mockResolvedValue({ executeCommand: SUCCESS });
});

afterEach(() => {
  useCommandArgumentsStore.getState().cancel();
  useConfirmationModalStore.getState().reset();
});

describe("dispatchCommand asking for arguments", () => {
  it("opens the form for a missing required argument from the palette, then runs with it", async () => {
    const onArguments = vi.fn();
    const running = dispatchCommand(TIMEOUT, executeBackend, {
      commandContext: CONTEXT,
      askForArguments: true,
      onArguments,
    });

    await vi.waitFor(() => expect(askedNames()).toEqual(["user_id", "minutes"]));
    expect(useCommandArgumentsStore.getState().request?.title).toBe("Timeout Member");
    expect(useCommandArgumentsStore.getState().request?.workspaceId).toBe("ws-1");
    expect(executeBackend).not.toHaveBeenCalled();

    useCommandArgumentsStore.getState().submit({ user_id: "u-2", minutes: 10 });
    await expect(running).resolves.toEqual(SUCCESS);

    expect(executeBackend).toHaveBeenCalledTimes(1);
    expect(executeBackend.mock.calls[0][0]).toMatchObject({
      commandId: "admin.timeout",
      args: { user_id: "u-2", minutes: 10 },
      commandContext: CONTEXT,
    });
    expect(onArguments).toHaveBeenCalledWith({ user_id: "u-2", minutes: 10 });
  });

  it("asks a keybind only for what its preset arguments leave out, and merges both", async () => {
    const running = dispatchCommand(TIMEOUT, executeBackend, {
      args: { user_id: "u-2", reason: "spam" },
      commandContext: CONTEXT,
      askForArguments: true,
    });

    await vi.waitFor(() => expect(askedNames()).toEqual(["minutes"]));
    useCommandArgumentsStore.getState().submit({ minutes: 5 });
    await running;

    expect(executeBackend.mock.calls[0][0].args).toEqual({
      user_id: "u-2",
      reason: "spam",
      minutes: 5,
    });
  });

  it("offers the members of the workspace the preset arguments name", async () => {
    const running = dispatchCommand(TIMEOUT, executeBackend, {
      args: { server_id: "ws-2", minutes: 5 },
      commandContext: CONTEXT,
      askForArguments: true,
    });

    await vi.waitFor(() => expect(askedNames()).toEqual(["user_id"]));
    expect(useCommandArgumentsStore.getState().request?.workspaceId).toBe("ws-2");
    useCommandArgumentsStore.getState().cancel();
    await running;
  });

  it("runs at once when the arguments and the context supply everything", async () => {
    await dispatchCommand(DND, executeBackend, {
      args: { mode: "on" },
      commandContext: CONTEXT,
      askForArguments: true,
    });

    expect(useCommandArgumentsStore.getState().request).toBeNull();
    expect(executeBackend.mock.calls[0][0].args).toEqual({ mode: "on" });
  });

  it("offers the optional arguments under More options, each time field whole", async () => {
    const running = dispatchCommand(BAN, executeBackend, {
      commandContext: CONTEXT,
      askForArguments: true,
    });
    await vi.waitFor(() => expect(askedNames()).toEqual(["user_id"]));
    expect(moreNames()).toEqual(["reason", "expires_at", "minutes"]);
    useCommandArgumentsStore.getState().submit({ user_id: "u-9", minutes: 60 });

    await running;
    expect(executeBackend.mock.calls[0][0].args).toEqual({ user_id: "u-9", minutes: 60 });
  });

  it("offers no time field under More options once part of it is given", async () => {
    void dispatchCommand(BAN, executeBackend, {
      args: { minutes: 30 },
      commandContext: CONTEXT,
      askForArguments: true,
    });
    await vi.waitFor(() => expect(askedNames()).toEqual(["user_id"]));
    expect(moreNames()).toEqual(["reason"]);
  });

  it("does not open the form only for optional arguments", async () => {
    await dispatchCommand(TIMEOUT, executeBackend, {
      args: { user_id: "u-1", minutes: 10 },
      commandContext: CONTEXT,
      askForArguments: true,
    });

    expect(useCommandArgumentsStore.getState().request).toBeNull();
    expect(executeBackend.mock.calls[0][0].args).toEqual({ user_id: "u-1", minutes: 10 });
  });

  it("runs nothing when the form is cancelled", async () => {
    const running = dispatchCommand(DND, executeBackend, {
      commandContext: CONTEXT,
      askForArguments: true,
    });
    await vi.waitFor(() => expect(askedNames()).toEqual(["mode", "minutes"]));
    useCommandArgumentsStore.getState().cancel();

    const result = await running;
    expect(result?.message).toBe("Cancelled");
    expect(executeBackend).not.toHaveBeenCalled();
  });

  it("asks for a workspace when no workspace is open", async () => {
    const running = dispatchCommand(DND, executeBackend, {
      args: { mode: "off" },
      commandContext: {},
      askForArguments: true,
    });

    await vi.waitFor(() => expect(askedNames()).toEqual(["server_id"]));
    useCommandArgumentsStore.getState().submit({ server_id: "ws-2" });
    await running;
    expect(executeBackend.mock.calls[0][0].args).toEqual({ mode: "off", server_id: "ws-2" });
  });

  it("never asks for a message: the person is told to select one", async () => {
    const result = await dispatchCommand(PIN, executeBackend, {
      commandContext: CONTEXT,
      askForArguments: true,
    });

    expect(result).toMatchObject({ status: "ERROR", message: "Select a message first" });
    expect(useCommandArgumentsStore.getState().request).toBeNull();
    expect(executeBackend).not.toHaveBeenCalled();
  });

  it("does not ask for a pipe stage, a plugin's call or a surface that does not ask", async () => {
    await dispatchCommand(DND, executeBackend, {
      commandContext: CONTEXT,
      askForArguments: true,
      isPipe: true,
    });
    await dispatchCommand(DND, executeBackend, {
      commandContext: CONTEXT,
      askForArguments: true,
      callerPluginId: "poll",
    });
    await dispatchCommand(DND, executeBackend, { commandContext: CONTEXT });

    expect(useCommandArgumentsStore.getState().request).toBeNull();
    // Each reaches the server as before, which names the missing argument.
    expect(executeBackend).toHaveBeenCalledTimes(3);
    for (const [input] of executeBackend.mock.calls) expect(input.args).toBeUndefined();
  });

  it("still asks a dangerous command's confirmation after the form, once", async () => {
    const ban = command("admin.ban", {
      title: "Ban Member",
      dangerous: true,
      arguments: [
        argument("server_id", CommandArgumentType.WORKSPACE_ID),
        argument("user_id", CommandArgumentType.USER_ID),
      ],
    });
    executeBackend
      .mockResolvedValueOnce({
        executeCommand: {
          ...SUCCESS,
          status: "CONFIRMATION_REQUIRED",
          message: "Confirm",
          confirmationRequired: {
            token: "t-1",
            argsHash: "h-1",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          },
        },
      })
      .mockResolvedValueOnce({ executeCommand: SUCCESS });

    const running = dispatchCommand(ban, executeBackend, {
      commandContext: CONTEXT,
      askForArguments: true,
    });
    await vi.waitFor(() => expect(askedNames()).toEqual(["user_id"]));
    useCommandArgumentsStore.getState().submit({ user_id: "u-9" });

    await vi.waitFor(() =>
      expect(useConfirmationModalStore.getState().request?.toolName).toBe("Ban Member"),
    );
    expect(useConfirmationModalStore.getState().request?.args).toEqual({ user_id: "u-9" });
    useConfirmationModalStore.getState().approve();

    await expect(running).resolves.toEqual(SUCCESS);
    expect(executeBackend).toHaveBeenCalledTimes(2);
    expect(executeBackend.mock.calls[1][0]).toMatchObject({
      args: { user_id: "u-9" },
      confirmation: { inBandToken: { token: "t-1", argsHash: "h-1" } },
    });
    expect(useCommandArgumentsStore.getState().request).toBeNull();
  });
});

describe("dispatchCommand asking for a topic", () => {
  const SET_TOPIC = command("chat.set_topic", {
    title: "Edit Topic…",
    category: "Conversations",
    arguments: [
      argument("server_id", CommandArgumentType.WORKSPACE_ID),
      argument("conversation_id", CommandArgumentType.CONVERSATION_ID),
      argument("topic", CommandArgumentType.STRING),
    ],
  });

  it("runs a preset that clears the topic without asking for it", async () => {
    await dispatchCommand(SET_TOPIC, executeBackend, {
      args: { topic: "" },
      commandContext: CONTEXT,
      askForArguments: true,
    });

    expect(useCommandArgumentsStore.getState().request).toBeNull();
    expect(executeBackend.mock.calls[0][0].args).toEqual({ topic: "" });
  });

  it("tells the form the command and the conversation it runs in", async () => {
    const running = dispatchCommand(SET_TOPIC, executeBackend, {
      commandContext: CONTEXT,
      askForArguments: true,
    });

    await vi.waitFor(() => expect(askedNames()).toEqual(["topic"]));
    expect(useCommandArgumentsStore.getState().request).toMatchObject({
      commandId: "chat.set_topic",
      conversationId: "conv-1",
    });
    useCommandArgumentsStore.getState().submit({ topic: "" });
    await running;

    expect(executeBackend.mock.calls[0][0].args).toEqual({ topic: "" });
  });
});
