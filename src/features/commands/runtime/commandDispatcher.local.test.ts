import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../shared/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { useLayoutPresetStore } from "../../../shell/state/useLayoutPresetStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { usePluginSettingsDialogStore } from "../../plugins/state/usePluginSettingsDialogStore";
import { useUnreadStore } from "../../conversations/state/useUnreadStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useCommandStore } from "../state/useCommandStore";
import { useKeybindProfileStore } from "../state/useKeybindProfileStore";
import { dispatchCommand, runDesktopLocalCommand } from "./commandDispatcher";
import { LOCAL_COMMANDS } from "./localCommands";
import type { CommandDefinition } from "../types";
import type { PluginInfo } from "../../plugins/types";
import { webPluginHost } from "../../plugins/web/webPluginHost";

function serveConversations(ids: string[]) {
  queryClient.setQueryData(queryKeys.channels("ws-1"), {
    items: ids.map((id) => ({ id })),
    pageInfo: { hasNext: false, hasPrev: false },
  });
}

describe("this app's own commands", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useShellStore.getState().reset();
  });

  afterEach(() => {
    queryClient.clear();
    useUnreadStore.setState({ counts: {} });
    useWorkspaceStore.setState({ workspaceId: null });
    useKeybindProfileStore.getState().setVimMode(false);
  });

  it("each has a handler", () => {
    for (const { id } of LOCAL_COMMANDS) {
      expect(runDesktopLocalCommand(id), id).toBe(true);
    }
  });

  it("goes to the previous unread conversation, wrapping to the last one", () => {
    serveConversations(["a", "b", "c", "d"]);
    useUnreadStore.setState({ counts: { a: 1, c: 2 } });
    useShellStore.setState({ selectedConversationId: "d" });

    runDesktopLocalCommand("workspace.previous_unread_channel");
    expect(useShellStore.getState().selectedConversationId).toBe("c");
    runDesktopLocalCommand("workspace.previous_unread_channel");
    expect(useShellStore.getState().selectedConversationId).toBe("a");
    runDesktopLocalCommand("workspace.previous_unread_channel");
    expect(useShellStore.getState().selectedConversationId).toBe("c");
  });

  it("closes a main-area plugin panel before the thread it covers, and leaves a tool-panel one", () => {
    const shell = () => useShellStore.getState();
    shell().openThreadForMessage("root-1");
    shell().openPluginPanel("chat.rim.k8s-pods", "pods", "main_area");

    runDesktopLocalCommand("workspace.close_panel");
    expect(shell().activePluginPanel).toBeNull();
    expect(shell().isThreadOpen).toBe(true);

    shell().openPluginPanel("chat.rim.k8s-pods", "notes", "tool_panel");
    runDesktopLocalCommand("workspace.close_panel");
    expect(shell().isThreadOpen).toBe(false);
    runDesktopLocalCommand("workspace.close_panel");
    expect(shell().activePluginPanel).toMatchObject({ panelId: "notes" });
  });

  it("opens and closes the shortcuts panel", () => {
    useCommandStore.setState({ isShortcutsPanelOpen: false });
    runDesktopLocalCommand("workspace.show_shortcuts");
    expect(useCommandStore.getState().isShortcutsPanelOpen).toBe(true);
    runDesktopLocalCommand("workspace.show_shortcuts");
    expect(useCommandStore.getState().isShortcutsPanelOpen).toBe(false);
  });

  it("turns Vim mode on and off", () => {
    runDesktopLocalCommand("workspace.toggle_vim_mode");
    expect(useKeybindProfileStore.getState().profile.vimMode).toBe(true);
    runDesktopLocalCommand("workspace.toggle_vim_mode");
    expect(useKeybindProfileStore.getState().profile.vimMode).toBe(false);
  });

  it("moves focus between panes", () => {
    useShellStore.setState({ focusedSurface: "mainSurface" });
    runDesktopLocalCommand("workspace.navigate_panel_left");
    expect(useShellStore.getState().focusedSurface).toBe("toolPanel");
    runDesktopLocalCommand("workspace.navigate_panel_right");
    expect(useShellStore.getState().focusedSurface).toBe("mainSurface");
  });

  it("cycles the layout presets", () => {
    useLayoutPresetStore.setState({ activePresetId: null });
    runDesktopLocalCommand("workspace.cycle_layout_preset");
    expect(useLayoutPresetStore.getState().activePresetId).not.toBeNull();
  });
});

describe("plugin panel commands", () => {
  const POD_PANEL = "workspace.open_plugin_panel.chat.rim.k8s-pods/pods";

  function servePlugins(health: PluginInfo["health"], runtime_kind?: PluginInfo["runtime_kind"]) {
    queryClient.setQueryData<PluginInfo[]>(queryKeys.plugins(), [
      {
        plugin_id: "chat.rim.k8s-pods",
        manifest_id: "chat.rim.k8s-pods",
        display_name: "Kubernetes Pods",
        version: "1.0.0",
        description: "",
        enabled: true,
        health,
        capabilities: [],
        approved_capabilities: [],
        approved_ai_commands: [],
        ai_callable_commands: [],
        ai_consent_required: false,
        fingerprint_changed: false,
        panels: [{ id: "pods", title: "Pods", slot: "main_area" }],
        ...(runtime_kind && { runtime_kind }),
      },
    ]);
  }

  const command: CommandDefinition = {
    id: POD_PANEL,
    title: "Open Pods",
    description: "",
    category: "Kubernetes Pods",
    sourceKind: "PLUGIN",
    executionTarget: "DESKTOP_LOCAL",
    requiredContext: [],
    requiredCapabilities: [],
    visibleInPalette: true,
    visibleInContextMenus: false,
    keybindCapable: true,
    dangerous: false,
  };
  const executeBackend = vi.fn();

  beforeEach(() => {
    useShellStore.getState().reset();
    executeBackend.mockReset();
  });

  afterEach(() => {
    queryClient.clear();
    vi.restoreAllMocks();
  });

  it("opens the panel in its slot without asking the server or the plugin", async () => {
    servePlugins("running");
    const result = await dispatchCommand(command, executeBackend);
    expect(result?.status).toBe("SUCCESS");
    expect(useShellStore.getState().activePluginPanel).toEqual({
      pluginId: "chat.rim.k8s-pods",
      panelId: "pods",
      slot: "main_area",
    });
    expect(executeBackend).not.toHaveBeenCalled();
  });

  it("refuses when the plugin is not running", async () => {
    servePlugins("stopped");
    const result = await dispatchCommand(command, executeBackend);
    expect(result).toMatchObject({
      status: "ERROR",
      message: "The plugin with this panel is not running",
    });
    expect(useShellStore.getState().activePluginPanel).toBeNull();
    expect(executeBackend).not.toHaveBeenCalled();
  });

  it("opens a web plugin's panel while the web host runs it, though the stored list says stopped", async () => {
    servePlugins("stopped", "WebSandboxed");
    vi.spyOn(webPluginHost, "status").mockReturnValue({ health: "running" });
    const result = await dispatchCommand(command, executeBackend);
    expect(result?.status).toBe("SUCCESS");
    expect(useShellStore.getState().activePluginPanel).toEqual({
      pluginId: "chat.rim.k8s-pods",
      panelId: "pods",
      slot: "main_area",
    });
  });

  it("refuses a web plugin's panel while the web host has not started it", async () => {
    servePlugins("stopped", "WebSandboxed");
    vi.spyOn(webPluginHost, "status").mockReturnValue({ health: "starting" });
    const result = await dispatchCommand(command, executeBackend);
    expect(result).toMatchObject({
      status: "ERROR",
      message: "The plugin with this panel is not running",
    });
    expect(useShellStore.getState().activePluginPanel).toBeNull();
  });
});

describe("plugin settings commands", () => {
  const command: CommandDefinition = {
    id: "workspace.open_plugin_settings.chat.rim.k8s-pods",
    title: "Plugin settings: Kubernetes Pods",
    description: "",
    category: "Kubernetes Pods",
    sourceKind: "PLUGIN",
    executionTarget: "DESKTOP_LOCAL",
    requiredContext: [],
    requiredCapabilities: [],
    visibleInPalette: true,
    visibleInContextMenus: false,
    keybindCapable: true,
    dangerous: false,
  };

  beforeEach(() => useShellStore.getState().reset());

  it("opens the plugin's settings form without asking the server or the plugin", async () => {
    const executeBackend = vi.fn();
    const result = await dispatchCommand(command, executeBackend);
    expect(result?.status).toBe("SUCCESS");
    // Over the current view, which stays as it was.
    expect(usePluginSettingsDialogStore.getState().pluginId).toBe("chat.rim.k8s-pods");
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "conversation" });
    usePluginSettingsDialogStore.getState().close();
    expect(executeBackend).not.toHaveBeenCalled();
  });
});
