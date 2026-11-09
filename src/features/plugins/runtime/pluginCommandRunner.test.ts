import { describe, expect, it, vi } from "vitest";

import { CommandSensitivity } from "../../../core/graphql/generated/schema-types";
import type { CommandDefinition } from "../../commands/types";
import type { PluginInfo } from "../types";
import {
  createPluginCommandRunner,
  PLUGIN_COMMANDS_PER_MINUTE,
  PLUGIN_COOLDOWN_MS,
  pluginCommandContext,
  type RunnerDeps,
} from "./pluginCommandRunner";

const PLUGIN = "dev.example.runner";

function plugin(overrides: Partial<PluginInfo> = {}): PluginInfo {
  return {
    plugin_id: PLUGIN,
    manifest_id: PLUGIN,
    display_name: "Runner",
    version: "0.1.0",
    description: "",
    enabled: true,
    capabilities: [],
    approved_capabilities: [],
    approved_ai_commands: [],
    ai_callable_commands: [],
    ai_consent_required: false,
    manifest_hash: "",
    fingerprint_changed: false,
    runs_commands: [],
    granted_commands: [],
    ...overrides,
  };
}

function builtIn(id: string, overrides: Partial<CommandDefinition> = {}): CommandDefinition {
  return {
    id,
    title: id,
    description: "",
    category: "Messages",
    sourceKind: "BUILT_IN",
    executionTarget: "BACKEND",
    requiredContext: [],
    requiredCapabilities: [],
    visibleInPalette: true,
    visibleInContextMenus: false,
    keybindCapable: true,
    dangerous: false,
    sensitivity: CommandSensitivity.SAFE,
    ...overrides,
  };
}

const SERVER: CommandDefinition[] = [
  builtIn("chat.list_channels"),
  builtIn("chat.post_message", { sensitivity: CommandSensitivity.MUTATING }),
  builtIn("chat.delete_message", { sensitivity: CommandSensitivity.RESTRICTED, dangerous: true }),
  builtIn("chat.risky", { dangerous: true }),
  builtIn("workspace.open_settings", { executionTarget: "DESKTOP_LOCAL" }),
  builtIn("workspace.odd_local", {
    executionTarget: "DESKTOP_LOCAL",
    sensitivity: CommandSensitivity.SENSITIVE,
  }),
  builtIn("user.my_macro", { sourceKind: "USER" }),
  // A server listing an app command must not make it runnable.
  builtIn("app.quit", { executionTarget: "DESKTOP_LOCAL" }),
];

const ALL = SERVER.map((c) => c.id).concat([
  "workspace.open_home",
  "workspace.go_back",
  "app.quit",
  "missing.command",
  "people.view_profile",
]);

const CHALLENGE = { token: "tok", argsHash: "hash", expiresAt: "2099-01-01T00:00:00Z" };

function setup(overrides: Partial<RunnerDeps> = {}, info: Partial<PluginInfo> = {}) {
  let now = 1_000_000;
  const record = vi.fn<RunnerDeps["record"]>(async () => null);
  const execute = vi.fn<RunnerDeps["execute"]>(async () => ({
    status: "SUCCESS",
    message: "done",
  }));
  const runLocal = vi.fn<RunnerDeps["runLocal"]>(() => ({ ok: true, message: "" }));
  const confirm = vi.fn<RunnerDeps["confirm"]>(async () => "approved" as const);
  const deps: RunnerDeps = {
    now: () => now,
    plugins: async () => [plugin({ runs_commands: ALL, granted_commands: ALL, ...info })],
    serverCommands: async () => SERVER,
    appCommands: () => [
      { ...builtIn("workspace.open_home"), pluginRunnable: true },
      { ...builtIn("workspace.go_back"), pluginRunnable: true },
      { ...builtIn("people.view_profile"), pluginRunnable: true },
      builtIn("app.quit"),
    ],
    context: () => ({
      workspaceId: "w-1",
      conversationId: "c-1",
      threadId: "t-1",
      selectedMessageId: "m-1",
      focusedSurface: "composer",
    }),
    execute,
    runLocal,
    busy: () => false,
    confirm,
    record,
    ...overrides,
  };
  const runner = createPluginCommandRunner(deps);
  return {
    run: (commandId: unknown, args?: unknown) =>
      runner.runCommandForPlugin(PLUGIN, commandId, args),
    record,
    execute,
    runLocal,
    confirm,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("runCommandForPlugin", () => {
  it("refuses another plugin's commands and agent commands, even when granted", async () => {
    const t = setup(
      {},
      {
        runs_commands: ["plugin.dev.example.other.wipe", "agents.approve_request"],
        granted_commands: ["plugin.dev.example.other.wipe", "agents.approve_request"],
      },
    );
    for (const id of [
      "plugin.dev.example.other.wipe",
      `plugin.${PLUGIN}.mine`,
      "agents.approve_request",
      "agents.clear_record",
    ]) {
      expect(await t.run(id), id).toMatchObject({ status: "refused", code: "NOT_ALLOWED" });
    }
    expect(await t.run(42)).toMatchObject({ status: "refused", code: "NOT_ALLOWED" });
    expect(t.execute).not.toHaveBeenCalled();
    expect(t.runLocal).not.toHaveBeenCalled();
  });

  it("refuses dangerous and RESTRICTED built-ins, user commands and app commands not marked runnable", async () => {
    const t = setup();
    for (const id of [
      "chat.delete_message",
      "chat.risky",
      "user.my_macro",
      "app.quit",
      "workspace.odd_local",
    ]) {
      expect(await t.run(id), id).toMatchObject({ status: "refused", code: "NOT_ALLOWED" });
    }
    expect(t.execute).not.toHaveBeenCalled();
    expect(t.runLocal).not.toHaveBeenCalled();
  });

  it("refuses NOT_GRANTED when the id is not granted, not listed, or the plugin is off", async () => {
    expect(await setup({}, { granted_commands: [] }).run("workspace.go_back")).toMatchObject({
      code: "NOT_GRANTED",
    });
    expect(
      await setup({}, { runs_commands: [], granted_commands: ["workspace.go_back"] }).run(
        "workspace.go_back",
      ),
    ).toMatchObject({ code: "NOT_GRANTED" });
    expect(await setup({}, { enabled: false }).run("workspace.go_back")).toMatchObject({
      code: "NOT_GRANTED",
    });
    expect(await setup({ plugins: async () => [] }).run("workspace.go_back")).toMatchObject({
      code: "NOT_GRANTED",
    });
  });

  it("refuses UNAVAILABLE when neither the server nor this app offers the id", async () => {
    const t = setup({ appCommands: () => [] });
    expect(await t.run("missing.command")).toMatchObject({ code: "UNAVAILABLE" });
    // An app command not offered here is unavailable too.
    expect(await t.run("workspace.go_back")).toMatchObject({ code: "UNAVAILABLE" });
    expect(await setup({ runLocal: () => null }).run("workspace.open_settings")).toMatchObject({
      code: "UNAVAILABLE",
    });
  });

  it("refuses RATE_LIMITED past the per-minute limit, without recording those calls", async () => {
    const t = setup();
    for (let i = 0; i < PLUGIN_COMMANDS_PER_MINUTE; i++) {
      expect((await t.run("workspace.go_back")).status).toBe("success");
    }
    expect(await t.run("workspace.go_back")).toMatchObject({ code: "RATE_LIMITED" });
    expect(t.record).toHaveBeenCalledTimes(PLUGIN_COMMANDS_PER_MINUTE);
    t.advance(60_000);
    expect((await t.run("workspace.go_back")).status).toBe("success");
  });

  it("runs an app command marked runnable and a SAFE desktop built-in through the local handler", async () => {
    const t = setup();
    expect(await t.run("workspace.go_back", { conversation_id: "c-2" })).toEqual({
      status: "success",
    });
    expect(await t.run("workspace.open_settings")).toEqual({ status: "success" });
    expect(t.runLocal.mock.calls).toEqual([
      [
        "workspace.go_back",
        { conversation_id: "c-2" },
        { workspaceId: "w-1", conversationId: "c-2" },
      ],
      [
        "workspace.open_settings",
        {},
        { workspaceId: "w-1", conversationId: "c-1", threadId: "t-1" },
      ],
    ]);
    expect(t.execute).not.toHaveBeenCalled();
  });

  it("fails a local command missing the argument its picker would ask for", async () => {
    const t = setup();
    expect(await t.run("people.view_profile")).toEqual({
      status: "error",
      message: "missing argument: user_id",
    });
    expect(await t.run("people.view_profile", { user_id: "u-1" })).toEqual({ status: "success" });
  });

  it("passes a local command's failure on as an error", async () => {
    const t = setup({ runLocal: () => ({ ok: false, message: "No panel is open" }) });
    expect(await t.run("workspace.open_settings")).toEqual({
      status: "error",
      message: "No panel is open",
    });
  });

  it("runs a backend built-in on the server as PLUGIN, in the person's context without the selection", async () => {
    const t = setup();
    expect(await t.run("chat.list_channels", { limit: 5 })).toEqual({
      status: "success",
      message: "done",
    });
    expect(t.execute).toHaveBeenCalledWith({
      commandId: "chat.list_channels",
      args: { limit: 5 },
      commandContext: { workspaceId: "w-1", conversationId: "c-1", threadId: "t-1" },
    });
  });

  it("never hands the plugin the command's output", async () => {
    const t = setup({
      execute: async () =>
        ({ status: "SUCCESS", message: "ok", payload: { secret: 1 } }) as unknown as Awaited<
          ReturnType<RunnerDeps["execute"]>
        >,
    });
    const result = await t.run("chat.list_channels");
    expect(result).toEqual({ status: "success", message: "ok" });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("asks the person on CONFIRMATION_REQUIRED and re-sends with the proof on approve", async () => {
    const execute = vi
      .fn<RunnerDeps["execute"]>()
      .mockResolvedValueOnce({
        status: "CONFIRMATION_REQUIRED",
        message: "",
        confirmationRequired: CHALLENGE,
      })
      .mockResolvedValueOnce({ status: "SUCCESS", message: "posted" });
    const t = setup({ execute });
    expect(await t.run("chat.post_message", { conversation_id: "c-9", text: "hi" })).toEqual({
      status: "success",
      message: "posted",
    });
    expect(t.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginName: "Runner",
        commandTitle: "chat.post_message",
        args: { conversation_id: "c-9", text: "hi" },
      }),
    );
    expect(execute.mock.calls[1][0]).toEqual({
      commandId: "chat.post_message",
      args: { conversation_id: "c-9", text: "hi" },
      commandContext: { workspaceId: "w-1", conversationId: "c-9" },
      confirmation: { inBandToken: { token: "tok", argsHash: "hash" } },
    });
  });

  it("refuses CONFIRMATION_DISMISSED on dismiss, then COOLING_DOWN for a minute", async () => {
    const execute = vi.fn<RunnerDeps["execute"]>(async () => ({
      status: "CONFIRMATION_REQUIRED",
      message: "",
      confirmationRequired: CHALLENGE,
    }));
    const t = setup({ execute, confirm: vi.fn(async () => "dismissed" as const) });
    expect(await t.run("chat.post_message")).toMatchObject({
      status: "refused",
      code: "CONFIRMATION_DISMISSED",
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(await t.run("chat.post_message")).toMatchObject({ code: "COOLING_DOWN" });
    t.advance(PLUGIN_COOLDOWN_MS);
    expect(await t.run("chat.post_message")).toMatchObject({ code: "CONFIRMATION_DISMISSED" });
  });

  it("refuses BUSY while another confirmation is open", async () => {
    const t = setup({
      busy: () => true,
      execute: async () => ({
        status: "CONFIRMATION_REQUIRED",
        message: "",
        confirmationRequired: CHALLENGE,
      }),
    });
    expect(await t.run("chat.post_message")).toMatchObject({ code: "BUSY" });
    expect(t.confirm).not.toHaveBeenCalled();
  });

  it("reports an expired confirmation as an error without a cooldown", async () => {
    const t = setup({
      confirm: vi.fn(async () => "expired" as const),
      execute: async () => ({
        status: "CONFIRMATION_REQUIRED",
        message: "",
        confirmationRequired: CHALLENGE,
      }),
    });
    expect(await t.run("chat.post_message")).toEqual({
      status: "error",
      message: "the confirmation expired",
    });
    expect(await t.run("chat.post_message")).toEqual({
      status: "error",
      message: "the confirmation expired",
    });
  });

  it("records every run with its outcome and code", async () => {
    const t = setup({}, { granted_commands: ["workspace.go_back"] });
    await t.run("workspace.go_back");
    await t.run("chat.post_message");
    expect(t.record.mock.calls).toEqual([
      [PLUGIN, "workspace.go_back", "success", undefined],
      [PLUGIN, "chat.post_message", "refused", "NOT_GRANTED"],
    ]);
  });
});

describe("pluginCommandContext", () => {
  const current = {
    workspaceId: "w-1",
    conversationId: "c-1",
    threadId: "t-1",
    selectedMessageId: "m-1",
  };

  it("keeps the workspace, conversation and thread and drops the selection", () => {
    expect(pluginCommandContext(current, {})).toEqual({
      workspaceId: "w-1",
      conversationId: "c-1",
      threadId: "t-1",
    });
  });

  it("lets ids in the args replace the person's, dropping what belongs to the old place", () => {
    expect(pluginCommandContext(current, { conversation_id: "c-2" })).toEqual({
      workspaceId: "w-1",
      conversationId: "c-2",
    });
    expect(pluginCommandContext(current, { server_id: "w-2" })).toEqual({ workspaceId: "w-2" });
    expect(
      pluginCommandContext(current, {
        workspace_id: "w-2",
        conversation_id: "c-3",
        thread_id: "t-3",
      }),
    ).toEqual({ workspaceId: "w-2", conversationId: "c-3", threadId: "t-3" });
    expect(pluginCommandContext({}, {})).toEqual({});
  });
});
