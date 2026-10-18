import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("./usePluginList", () => ({
  usePluginList: vi.fn(() => ({ data: undefined })),
}));

import { parsePluginCommandId, usePluginCommands } from "./usePluginCommands";
import { usePluginList } from "./usePluginList";
import type { PluginCommandInfo, PluginInfo } from "../types";

function command(id: string, overrides: Partial<PluginCommandInfo> = {}): PluginCommandInfo {
  return {
    id,
    qualified_id: `plugin.chat.rim.k8s-pods.${id}`,
    title: id,
    description: `${id} description`,
    keybind_capable: true,
    dangerous: false,
    ai_callable: true,
    arguments: [],
    ...overrides,
  };
}

function plugin(overrides: Partial<PluginInfo> = {}): PluginInfo {
  return {
    plugin_id: "chat.rim.k8s-pods",
    manifest_id: "chat.rim.k8s-pods",
    display_name: "Kubernetes Pods",
    version: "0.1.0",
    description: "",
    enabled: true,
    capabilities: [],
    approved_capabilities: [],
    approved_ai_commands: [],
    ai_callable_commands: [],
    ai_consent_required: false,
    fingerprint_changed: false,
    commands: [
      command("refresh", { title: "Refresh pods" }),
      command("restart_pod", { title: "Restart pod", dangerous: true, keybind_capable: false }),
    ],
    context_actions: [],
    health: "stopped",
    ...overrides,
  };
}

function commandsOf(plugins: PluginInfo[]) {
  vi.mocked(usePluginList).mockReturnValue({ data: plugins } as ReturnType<typeof usePluginList>);
  return renderHook(() => usePluginCommands()).result.current;
}

describe("usePluginCommands", () => {
  it("lists every manifest command of an enabled plugin for the palette", () => {
    const commands = commandsOf([plugin()]);
    expect(commands.map((c) => [c.id, c.title, c.category, c.keybindCapable, c.dangerous])).toEqual(
      [
        ["plugin.chat.rim.k8s-pods.refresh", "Refresh pods", "Kubernetes Pods", true, false],
        ["plugin.chat.rim.k8s-pods.restart_pod", "Restart pod", "Kubernetes Pods", false, true],
      ],
    );
    expect(commands.every((c) => c.visibleInPalette && c.sourceKind === "PLUGIN")).toBe(true);
  });

  it("keeps a command that needs arguments out of the palette and keybinds", () => {
    const commands = commandsOf([
      plugin({
        commands: [
          command("restart_pod", {
            dangerous: true,
            arguments: [{ name: "pod", type: "string", required: true }],
          }),
        ],
      }),
    ]);
    expect(commands[0]).toMatchObject({ visibleInPalette: false, keybindCapable: false });
  });

  it("carries each command's required context, to its context actions too", () => {
    const commands = commandsOf([
      plugin({
        commands: [command("restart_pod", { required_context: ["message"] }), command("refresh")],
        context_actions: [
          {
            id: "restart",
            title: "Restart this pod",
            command_id: "plugin.chat.rim.k8s-pods.restart_pod",
            context_types: ["message"],
          },
        ],
      }),
    ]);
    expect(commands.map((c) => [c.title, c.requiredContext])).toEqual([
      ["restart_pod", ["message"]],
      ["refresh", []],
      ["Restart this pod", ["message"]],
    ]);
  });

  it("leaves out a disabled plugin's commands", () => {
    expect(commandsOf([plugin({ enabled: false })])).toEqual([]);
  });

  it("shows context actions only in context menus", () => {
    const commands = commandsOf([
      plugin({
        context_actions: [
          {
            id: "restart",
            title: "Restart this pod",
            command_id: "plugin.chat.rim.k8s-pods.restart_pod",
            context_types: ["message"],
          },
        ],
      }),
    ]);
    const action = commands.find((c) => c.title === "Restart this pod");
    expect(action).toMatchObject({
      visibleInPalette: false,
      visibleInContextMenus: true,
      keybindCapable: false,
      dangerous: true,
      contextTypes: ["message"],
    });
  });
});

describe("usePluginCommands — open panel commands", () => {
  const panels = [
    { id: "pods", title: "Pods", slot: "main_area" as const },
    { id: "notes", title: "Notes" },
  ];

  it("adds an Open command per panel of a running plugin, for the palette and keybinds", () => {
    const commands = commandsOf([plugin({ health: "running", commands: [], panels })]);
    expect(commands.map((c) => [c.id, c.title, c.category])).toEqual([
      ["workspace.open_plugin_panel.chat.rim.k8s-pods/pods", "Open Pods", "Kubernetes Pods"],
      ["workspace.open_plugin_panel.chat.rim.k8s-pods/notes", "Open Notes", "Kubernetes Pods"],
    ]);
    expect(commands[0]).toMatchObject({
      sourceKind: "PLUGIN",
      executionTarget: "DESKTOP_LOCAL",
      visibleInPalette: true,
      visibleInContextMenus: false,
      keybindCapable: true,
      dangerous: false,
    });
  });

  it("lists them after the plugin's manifest commands", () => {
    const commands = commandsOf([plugin({ health: "running", panels })]);
    expect(commands.map((c) => c.title)).toEqual([
      "Refresh pods",
      "Restart pod",
      "Open Pods",
      "Open Notes",
    ]);
  });

  it("adds none for a plugin that is not running or not enabled", () => {
    expect(commandsOf([plugin({ health: "stopped", commands: [], panels })])).toEqual([]);
    expect(commandsOf([plugin({ health: "crashed", commands: [], panels })])).toEqual([]);
    expect(
      commandsOf([plugin({ enabled: false, health: "running", commands: [], panels })]),
    ).toEqual([]);
  });
});

describe("usePluginCommands plugin settings", () => {
  const setting = {
    key: "context",
    title: "Context",
    description: "",
    value_type: "string" as const,
    is_secret: false,
  };

  it("adds a settings command per enabled plugin that declares settings, last", () => {
    const commands = commandsOf([
      plugin({ settings_schema: [setting] }),
      plugin({ plugin_id: "dev.example.plain", display_name: "Plain", commands: [] }),
      plugin({
        plugin_id: "dev.example.off",
        display_name: "Off",
        enabled: false,
        commands: [],
        settings_schema: [setting],
      }),
    ]);
    expect(commands.map((c) => c.title)).toEqual([
      "Refresh pods",
      "Restart pod",
      "Plugin settings: Kubernetes Pods",
    ]);
    expect(commands[2]).toMatchObject({
      id: "workspace.open_plugin_settings.chat.rim.k8s-pods",
      category: "Kubernetes Pods",
      executionTarget: "DESKTOP_LOCAL",
      visibleInPalette: true,
      keybindCapable: true,
      dangerous: false,
    });
  });
});

describe("parsePluginCommandId", () => {
  it("parses a valid plugin command ID", () => {
    const result = parsePluginCommandId("plugin.my-plugin.do_something");
    expect(result).toEqual({
      pluginId: "my-plugin",
      command: "do_something",
    });
  });

  it("parses command ID with dots in the command part", () => {
    const result = parsePluginCommandId("plugin.my-plugin.sub.command");
    expect(result).toEqual({
      pluginId: "my-plugin",
      command: "sub.command",
    });
  });

  it("returns null for non-plugin command IDs", () => {
    expect(parsePluginCommandId("chat.send_message")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parsePluginCommandId("")).toBeNull();
  });

  it("returns null for malformed plugin prefix", () => {
    expect(parsePluginCommandId("plugin.")).toBeNull();
  });

  it("returns null for just 'plugin' with no dots", () => {
    expect(parsePluginCommandId("plugin")).toBeNull();
  });

  it("returns null for 'plugin.only-id' (missing command)", () => {
    expect(parsePluginCommandId("plugin.only-id")).toBeNull();
  });

  it("parses plugin ID with underscores", () => {
    const result = parsePluginCommandId("plugin.my_plugin.run_task");
    expect(result).toEqual({
      pluginId: "my_plugin",
      command: "run_task",
    });
  });

  it("parses plugin ID with numbers", () => {
    const result = parsePluginCommandId("plugin.plugin123.cmd456");
    expect(result).toEqual({
      pluginId: "plugin123",
      command: "cmd456",
    });
  });
});
