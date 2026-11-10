import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => mocks.request(...args) },
}));
vi.mock("../../../shared/toast", () => ({ toast: mocks.toast }));

import {
  CommandArgumentType,
  CommandSensitivity,
} from "../../../core/graphql/generated/schema-types";
import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { useShellStore } from "../../../shell/state/useShellStore";
import { tomorrowMorning } from "../../notifications/rules";
import { useCommandArgumentsStore } from "../../commands/state/useCommandArgumentsStore";
import type { CommandResult } from "../../commands/types";
import type { SpaceRecord } from "../../relay/state/relayDb";
import { useRelayStore } from "../../relay/state/useRelayStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import type { AccountMacro, MacroStepCommand } from "../api/useAccountMacros";
import { runMacro } from "./runMacro";

function stepCommand(id: string, title: string, extra: Partial<MacroStepCommand> = {}) {
  return {
    id,
    title,
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
    sensitivity: CommandSensitivity.SAFE,
    aiCallable: true,
    arguments: [],
    ...extra,
  } satisfies MacroStepCommand;
}

const STEP_COMMANDS: MacroStepCommand[] = [
  stepCommand("chat.set_topic", "Set Topic", {
    arguments: [
      {
        name: "topic",
        title: "Topic",
        argumentType: CommandArgumentType.STRING,
        required: true,
      },
    ],
  }),
  stepCommand("chat.mark_conversation_read", "Mark Read"),
  stepCommand("chat.join_channel", "Join Channel", {
    arguments: [
      {
        name: "conversation_id",
        title: "Channel",
        argumentType: CommandArgumentType.CONVERSATION_ID,
        required: true,
      },
    ],
  }),
  stepCommand("chat.post_message", "Post Message", {
    arguments: [
      { name: "text", title: "Text", argumentType: CommandArgumentType.STRING, required: true },
    ],
  }),
  stepCommand("chat.pin_latest", "Pin Latest"),
  stepCommand("state.set", "Set State", {
    arguments: [
      { name: "key", title: "Key", argumentType: CommandArgumentType.STRING, required: true },
      { name: "value", title: "Value", argumentType: CommandArgumentType.STRING, required: true },
    ],
  }),
  stepCommand("notifications.mute_conversation", "Mute Conversation", {
    arguments: [
      {
        name: "duration",
        title: "Duration",
        argumentType: CommandArgumentType.ENUM,
        required: true,
        allowedValues: ["1h", "8h", "until_tomorrow", "forever", "until", "minutes"],
      },
      { name: "until", title: "Until", argumentType: CommandArgumentType.STRING, required: false },
      {
        name: "minutes",
        title: "Minutes",
        argumentType: CommandArgumentType.INTEGER,
        required: false,
      },
    ],
  }),
];

function macro(overrides: Partial<AccountMacro> & { id: string }): AccountMacro {
  return {
    title: overrides.id,
    description: "",
    isEnabled: true,
    aiCallable: false,
    nlDescription: "",
    intentSamples: [],
    steps: [],
    ...overrides,
  };
}

function step(commandId: string, args: Record<string, unknown> = {}, ask: string[] = []) {
  return { commandId, args, ask };
}

function haveMacros(...macros: AccountMacro[]) {
  queryClient.setQueryData(queryKeys.accountMacros, macros);
  queryClient.setQueryData(queryKeys.macroStepCommands, STEP_COMMANDS);
}

const ok: CommandResult = { status: "SUCCESS", message: "", payload: null, followUpCommands: [] };

/** Each `executeCommand` sent, with its variables. */
function executed(): { input: Record<string, unknown>; workspaceId?: string }[] {
  return mocks.request.mock.calls.map(
    ([, variables]) => variables as { input: Record<string, unknown>; workspaceId?: string },
  );
}

beforeEach(() => {
  mocks.request.mockResolvedValue({ executeCommand: ok });
  useWorkspaceStore.getState().setWorkspaceId("ws-1");
});

afterEach(() => {
  vi.clearAllMocks();
  mocks.request.mockReset();
  queryClient.clear();
  useWorkspaceStore.getState().clearWorkspaceId();
  useShellStore.getState().reset();
  useRelayStore.setState({ spaces: {} });
  useCommandArgumentsStore.getState().cancel();
});

describe("runMacro", () => {
  it("runs each step in order as a MACRO call in the run's context, then says it ran", async () => {
    haveMacros(
      macro({
        id: "user.tidy",
        title: "Tidy",
        steps: [step("chat.set_topic", { topic: "Today" }), step("chat.mark_conversation_read")],
      }),
    );

    await expect(
      runMacro("user.tidy", { workspaceId: "ws-1", conversationId: "c-1" }),
    ).resolves.toBe(true);

    expect(executed().map(({ input }) => [input.commandId, input.args, input.initiator])).toEqual([
      ["chat.set_topic", { topic: "Today" }, "MACRO"],
      ["chat.mark_conversation_read", {}, "MACRO"],
    ]);
    for (const { input } of executed()) {
      expect(input.commandContext).toEqual({ workspaceId: "ws-1", conversationId: "c-1" });
    }
    expect(mocks.toast.success).toHaveBeenCalledWith('Macro "Tidy" ran');
  });

  it("runs a join step on a fixed channel, then the next step, in order", async () => {
    haveMacros(
      macro({
        id: "user.join",
        steps: [
          step("chat.join_channel", { conversation_id: "c-eng" }),
          step("chat.post_message", { text: "Welcome\n- read the docs\n- say hi" }),
        ],
      }),
    );

    await expect(runMacro("user.join", { workspaceId: "ws-1" })).resolves.toBe(true);

    expect(executed().map(({ input }) => [input.commandId, input.args])).toEqual([
      ["chat.join_channel", { conversation_id: "c-eng" }],
      ["chat.post_message", { text: "Welcome\n- read the docs\n- say hi" }],
    ]);
  });

  it("sends a server step to the server that hosts the workspace", async () => {
    useRelayStore.setState({
      spaces: { "ws-2": { spaceId: "ws-2", hostServerId: "srv-2" } as SpaceRecord },
    });
    haveMacros(macro({ id: "user.read", steps: [step("chat.mark_conversation_read")] }));

    await runMacro("user.read", { workspaceId: "ws-2" });

    expect(executed()[0]?.workspaceId).toBe("ws-2");
  });

  it("runs an app step in this app", async () => {
    haveMacros(
      macro({
        id: "user.unreads",
        steps: [step("workspace.open_unreads"), step("chat.mark_conversation_read")],
      }),
    );

    await runMacro("user.unreads", { workspaceId: "ws-1" });

    expect(useShellStore.getState().mainSurface.kind).toBe("unreads");
    expect(executed().map(({ input }) => input.commandId)).toEqual(["chat.mark_conversation_read"]);
  });

  it("asks for every asked argument in one form first, and runs nothing when it is cancelled", async () => {
    haveMacros(
      macro({
        id: "user.topic",
        title: "Topic",
        steps: [step("chat.mark_conversation_read"), step("chat.set_topic", {}, ["topic"])],
      }),
    );

    const run = runMacro("user.topic", { workspaceId: "ws-1" });
    await vi.waitFor(() => expect(useCommandArgumentsStore.getState().request).not.toBeNull());
    const request = useCommandArgumentsStore.getState().request;
    expect(request?.title).toBe("Topic");
    expect(request?.workspaceId).toBe("ws-1");
    expect(request?.arguments).toEqual([]);
    expect(request?.steps).toEqual([
      expect.objectContaining({
        key: "1",
        labelPrefix: "Step 2 · Set Topic: ",
        commandId: "chat.set_topic",
        workspaceId: "ws-1",
        arguments: [
          expect.objectContaining({
            name: "topic",
            argumentType: CommandArgumentType.STRING,
            required: true,
          }),
        ],
      }),
    ]);
    useCommandArgumentsStore.getState().cancel();

    await expect(run).resolves.toBe(false);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("runs the step with what the form was given", async () => {
    haveMacros(macro({ id: "user.topic", steps: [step("chat.set_topic", {}, ["topic"])] }));

    const run = runMacro("user.topic", { workspaceId: "ws-1" });
    await vi.waitFor(() => expect(useCommandArgumentsStore.getState().request).not.toBeNull());
    useCommandArgumentsStore.getState().submit({ "0:topic": "Launch" });
    await run;

    expect(executed()[0]?.input.args).toEqual({ topic: "Launch" });
  });

  it("asks each step with its own command's fields, and what they follow", async () => {
    haveMacros(
      macro({
        id: "user.quiet",
        title: "Quiet",
        steps: [
          step("state.set", { key: "counter" }, ["value"]),
          step("notifications.mute_conversation", { until: "2999-01-01T00:00:00Z" }, ["duration"]),
        ],
      }),
    );

    const run = runMacro("user.quiet", { workspaceId: "ws-1", conversationId: "conv-1" });
    await vi.waitFor(() => expect(useCommandArgumentsStore.getState().request).not.toBeNull());
    const steps = useCommandArgumentsStore.getState().request?.steps ?? [];
    expect(steps[0]).toMatchObject({
      key: "0",
      commandId: "state.set",
      givenValues: { key: "counter" },
      conversationId: "conv-1",
    });
    expect(steps[0].arguments.map((a) => a.name)).toEqual(["value"]);
    expect(steps[1]).toMatchObject({
      key: "1",
      labelPrefix: "Step 2 · Mute Conversation: ",
      commandId: "notifications.mute_conversation",
    });
    expect(steps[1].arguments.map((a) => a.name)).toEqual(["duration", "until", "minutes"]);

    useCommandArgumentsStore.getState().submit({ "0:value": "42", "1:duration": "until_tomorrow" });
    await expect(run).resolves.toBe(true);

    expect(executed()[0]?.input.args).toEqual({ key: "counter", value: "42" });
    expect(executed()[1]?.input.args).toEqual({
      duration: "until",
      until: tomorrowMorning().toISOString(),
    });
  });

  it("runs a step with a topic cleared in the form", async () => {
    haveMacros(macro({ id: "user.topic", steps: [step("chat.set_topic", {}, ["topic"])] }));

    const run = runMacro("user.topic", { workspaceId: "ws-1" });
    await vi.waitFor(() => expect(useCommandArgumentsStore.getState().request).not.toBeNull());
    useCommandArgumentsStore.getState().submit({ "0:topic": "" });
    await run;

    expect(executed()[0]?.input.args).toEqual({ topic: "" });
  });

  it("stops at the first step that fails and says which it was and why", async () => {
    mocks.request
      .mockResolvedValueOnce({ executeCommand: ok })
      .mockResolvedValueOnce({ executeCommand: { ...ok, status: "ERROR", message: "no topic" } });
    haveMacros(
      macro({
        id: "user.three",
        steps: [
          step("chat.mark_conversation_read"),
          step("chat.set_topic", { topic: "x" }),
          step("chat.pin_latest"),
        ],
      }),
    );

    await expect(runMacro("user.three", { workspaceId: "ws-1" })).resolves.toBe(false);

    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(mocks.toast.error).toHaveBeenCalledWith("Step 2 (Set Topic) failed: no topic");
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });

  it("says a step's plugin is not installed", async () => {
    haveMacros(macro({ id: "user.poll", steps: [step("plugin.dev.rim.poll.open")] }));

    await runMacro("user.poll", { workspaceId: "ws-1" });

    expect(mocks.toast.error).toHaveBeenCalledWith(
      "Step 1 (plugin.dev.rim.poll.open) failed: its plugin isn't installed on this device",
    );
  });

  it("runs a nested macro's steps in its place", async () => {
    haveMacros(
      macro({ id: "user.inner", steps: [step("chat.pin_latest")] }),
      macro({
        id: "user.outer",
        steps: [step("chat.mark_conversation_read"), step("user.inner"), step("chat.pin_latest")],
      }),
    );

    await runMacro("user.outer", { workspaceId: "ws-1" });

    expect(executed().map(({ input }) => input.commandId)).toEqual([
      "chat.mark_conversation_read",
      "chat.pin_latest",
      "chat.pin_latest",
    ]);
  });

  it("refuses a macro that runs itself, a turned-off nested macro and too many steps", async () => {
    haveMacros(
      macro({ id: "user.loop", title: "Loop", steps: [step("user.back")] }),
      macro({ id: "user.back", steps: [step("user.loop")] }),
      macro({ id: "user.off", isEnabled: false, steps: [step("chat.pin_latest")] }),
      macro({ id: "user.uses-off", title: "Uses off", steps: [step("user.off")] }),
      macro({
        id: "user.many",
        title: "Many",
        steps: Array.from({ length: 20 }, () => step("user.twenty")),
      }),
      macro({
        id: "user.twenty",
        steps: Array.from({ length: 20 }, () => step("chat.pin_latest")),
      }),
    );

    await runMacro("user.loop", { workspaceId: "ws-1" });
    await runMacro("user.uses-off", { workspaceId: "ws-1" });
    await runMacro("user.many", { workspaceId: "ws-1" });

    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.toast.error).toHaveBeenNthCalledWith(
      1,
      'Macro "Loop" can\'t run: it runs itself through one of its steps',
    );
    expect(mocks.toast.error).toHaveBeenNthCalledWith(
      2,
      'Macro "Uses off" can\'t run: a step runs a macro that is gone or turned off (user.off)',
    );
    expect(mocks.toast.error).toHaveBeenNthCalledWith(
      3,
      'Macro "Many" can\'t run: it runs more than 100 steps',
    );
  });

  it("runs no macro that is turned off or not the person's", async () => {
    haveMacros(macro({ id: "user.off", title: "Off", isEnabled: false }));

    await runMacro("user.off", { workspaceId: "ws-1" });
    await runMacro("user.gone", { workspaceId: "ws-1" });

    expect(mocks.toast.info).toHaveBeenCalledWith('Macro "Off" is turned off');
    expect(mocks.toast.error).toHaveBeenCalledWith("That macro is not one of yours");
    expect(mocks.request).not.toHaveBeenCalled();
  });
});

describe("a macro step that mutes until tomorrow", () => {
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
    haveMacros(
      macro({
        id: "user.quiet",
        steps: [
          step("notifications.mute_conversation", {
            conversation_id: "c-1",
            duration: "until_tomorrow",
          }),
        ],
      }),
    );
    queryClient.setQueryData(queryKeys.macroStepCommands, [
      ...STEP_COMMANDS,
      stepCommand("notifications.mute_conversation", "Mute Conversation", {
        arguments: [
          {
            name: "duration",
            title: "Duration",
            argumentType: CommandArgumentType.ENUM,
            required: true,
            allowedValues: ["1h", "8h", "until_tomorrow", "forever", "until"],
          },
        ],
      }),
    ]);

    await expect(runMacro("user.quiet", { workspaceId: "ws-1" })).resolves.toBe(true);

    expect(executed().map(({ input }) => input.args)).toEqual([
      { conversation_id: "c-1", duration: "until", until: "2026-11-10T14:00:00.000Z" },
    ]);
  });
});
