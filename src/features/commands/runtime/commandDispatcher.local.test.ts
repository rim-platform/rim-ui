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
import { useSearchOverlayStore } from "../../messages/state/useSearchOverlayStore";
import { dispatchCommand, runDesktopLocalCommand } from "./commandDispatcher";
import { LOCAL_COMMANDS } from "./localCommands";
import type { CommandDefinition } from "../types";
import type { PluginInfo } from "../../plugins/types";
import { webPluginHost } from "../../plugins/web/webPluginHost";
import { useBlockedConversations } from "../../relay/state/useBlockedConversations";
import { toast } from "../../../shared/toast";

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

  it("closes a main-area plugin panel, then the thread, then a side plugin panel", () => {
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
    expect(shell().activePluginPanel).toBeNull();
  });

  it("says no panel is open when Close Panel has nothing to close", async () => {
    const closePanel: CommandDefinition = {
      id: "workspace.close_panel",
      title: "Close Panel",
      description: "",
      category: "Workspace",
      sourceKind: "BUILT_IN",
      executionTarget: "DESKTOP_LOCAL",
      requiredContext: [],
      requiredCapabilities: [],
      visibleInPalette: true,
      visibleInContextMenus: false,
      keybindCapable: true,
      dangerous: false,
    };
    await expect(dispatchCommand(closePanel, vi.fn())).resolves.toMatchObject({
      status: "ERROR",
      message: "No panel is open",
    });
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

  it("says so when there is no unread conversation to go to", () => {
    serveConversations(["c-1", "c-2"]);
    runDesktopLocalCommand("workspace.next_unread_channel");
    runDesktopLocalCommand("workspace.previous_unread_channel");
    expect(toast.info).toHaveBeenCalledTimes(2);
    expect(toast.info).toHaveBeenCalledWith("No unread conversations");
  });

  it("says so when there is no thread to reopen", () => {
    useShellStore.setState({ lastClosedThreadId: null });
    runDesktopLocalCommand("workspace.reopen_last_thread");
    expect(toast.info).toHaveBeenCalledWith("No thread to reopen");
  });

  it("workspace.back_to_workspace returns from the DM", () => {
    queryClient.setQueryData(queryKeys.myServers(), [{ id: "ws-1", name: "Acme", owner: null }]);
    useShellStore.getState().setSelectedConversationId("c-design");
    useShellStore.getState().setDirectOrigin({
      workspaceId: "ws-1",
      conversationId: "c-design",
      spaceId: "direct-1",
      openedId: "dm-dan",
    });
    useWorkspaceStore.getState().setWorkspaceId("direct-1");
    useShellStore.getState().setSelectedConversationId("dm-dan");

    runDesktopLocalCommand("workspace.back_to_workspace");
    expect(useWorkspaceStore.getState().workspaceId).toBe("ws-1");
    expect(useShellStore.getState().selectedConversationId).toBe("c-design");
    expect(useShellStore.getState().directOrigin).toBeNull();
  });

  it("opens no conversation hidden because someone blocked started it, and says why", () => {
    useBlockedConversations.getState().setIn("remote-direct", { "dm-alice": "rimp1_alice" });
    useShellStore.getState().setSelectedConversationId("c-carol");

    for (const id of ["workspace.navigate_to_dm", "workspace.navigate_to_channel"]) {
      runDesktopLocalCommand(id, { conversationId: "dm-alice", serverId: "remote-direct" });
    }

    expect(useShellStore.getState().selectedConversationId).toBe("c-carol");
    expect(toast.info).toHaveBeenCalledTimes(2);
    expect(vi.mocked(toast.info).mock.calls[0][1]).toEqual({
      description: "Unblock them in Settings → Direct messages to message them.",
    });
    useBlockedConversations.getState().reset();
  });

  it("opens a conversation of another space that is not hidden", () => {
    useBlockedConversations.getState().setIn("remote-direct", { "dm-alice": "rimp1_alice" });
    runDesktopLocalCommand("workspace.navigate_to_dm", {
      conversationId: "dm-carol",
      serverId: "remote-direct",
    });
    expect(useShellStore.getState().selectedConversationId).toBe("dm-carol");
    useBlockedConversations.getState().reset();
  });

  it("takes a navigation target under either spelling of its argument", () => {
    runDesktopLocalCommand("workspace.navigate_to_channel", { conversation_id: "c-snake" });
    expect(useShellStore.getState().selectedConversationId).toBe("c-snake");
    runDesktopLocalCommand("workspace.navigate_to_dm", { conversationId: "c-camel" });
    expect(useShellStore.getState().selectedConversationId).toBe("c-camel");
    runDesktopLocalCommand("workspace.switch_workspace", { workspace_id: "ws-snake" });
    expect(useWorkspaceStore.getState().workspaceId).toBe("ws-snake");
    runDesktopLocalCommand("workspace.switch_workspace", { workspaceId: "ws-camel" });
    expect(useWorkspaceStore.getState().workspaceId).toBe("ws-camel");
  });

  it("navigates nowhere without a target", () => {
    useShellStore.getState().setSelectedConversationId("c-here");
    runDesktopLocalCommand("workspace.navigate_to_channel");
    runDesktopLocalCommand("workspace.navigate_to_dm", { conversationId: " " });
    runDesktopLocalCommand("workspace.switch_workspace", {});
    expect(useShellStore.getState().selectedConversationId).toBe("c-here");
    expect(useWorkspaceStore.getState().workspaceId).toBe("ws-1");
    expect(useCommandStore.getState().isCommandPaletteOpen).toBe(false);
  });

  it("asks which target when a keybind runs a navigation command without one", async () => {
    const command = { id: "workspace.navigate_to_channel" } as CommandDefinition;
    await dispatchCommand(command, vi.fn());
    expect(useCommandStore.getState().targetPicker).toEqual({
      commandId: "workspace.navigate_to_channel",
      kind: "channel",
    });
    expect(useCommandStore.getState().isCommandPaletteOpen).toBe(true);

    useCommandStore.getState().closeCommandPalette();
    await dispatchCommand(command, vi.fn(), { args: { conversation_id: "c-1" } });
    expect(useCommandStore.getState().isCommandPaletteOpen).toBe(false);
    expect(useShellStore.getState().selectedConversationId).toBe("c-1");
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
        approved_capabilities: ["ui.panel"],
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

describe("Search Messages", () => {
  const command: CommandDefinition = {
    id: "chat.search_messages",
    title: "Search Messages",
    description: "Search workspace messages by text content.",
    category: "Chat",
    sourceKind: "BUILT_IN",
    executionTarget: "BACKEND",
    requiredContext: [],
    requiredCapabilities: [],
    visibleInPalette: true,
    visibleInContextMenus: false,
    keybindCapable: true,
    dangerous: false,
  };
  const found = { status: "SUCCESS", message: "1 result", payload: null, followUpCommands: [] };
  const executeBackend = vi.fn();

  beforeEach(() => {
    executeBackend.mockReset();
    executeBackend.mockResolvedValue({ executeCommand: found });
  });

  afterEach(() => useSearchOverlayStore.getState().close());

  it("opens the search overlay for Search Messages without a query", async () => {
    useSearchOverlayStore.setState({ scope: { kind: "conversation", conversationId: "conv-1" } });
    const result = await dispatchCommand(command, executeBackend, {
      commandContext: { workspaceId: "ws-1" },
    });
    expect(result?.status).toBe("SUCCESS");
    expect(useSearchOverlayStore.getState()).toMatchObject({
      isOpen: true,
      query: "",
      scope: { kind: "all" },
    });
    expect(executeBackend).not.toHaveBeenCalled();
  });

  it("opens the search overlay for a blank query", async () => {
    await dispatchCommand(command, executeBackend, { args: { query: "  " } });
    expect(useSearchOverlayStore.getState().isOpen).toBe(true);
    expect(executeBackend).not.toHaveBeenCalled();
  });

  it("runs the server search when a query is given", async () => {
    const result = await dispatchCommand(command, executeBackend, { args: { query: "canary" } });
    expect(result).toEqual(found);
    expect(executeBackend).toHaveBeenCalledWith({
      commandId: "chat.search_messages",
      args: { query: "canary" },
    });
    expect(useSearchOverlayStore.getState().isOpen).toBe(false);
  });

  it("runs the server search as a piped stage", async () => {
    const result = await dispatchCommand(command, executeBackend, { isPipe: true });
    expect(result).toEqual(found);
    expect(executeBackend).toHaveBeenCalledWith({
      commandId: "chat.search_messages",
      isPipe: true,
    });
    expect(useSearchOverlayStore.getState().isOpen).toBe(false);
  });
});
