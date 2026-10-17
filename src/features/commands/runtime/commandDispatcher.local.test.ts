import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../shared/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { useLayoutPresetStore } from "../../../shell/state/useLayoutPresetStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useUnreadStore } from "../../conversations/state/useUnreadStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useCommandStore } from "../state/useCommandStore";
import { useKeybindProfileStore } from "../state/useKeybindProfileStore";
import { runDesktopLocalCommand } from "./commandDispatcher";
import { LOCAL_COMMANDS } from "./localCommands";

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
