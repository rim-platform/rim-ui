import { describe, it, expect, beforeEach } from "vitest";
import { useShellStore } from "./useShellStore";

describe("useShellStore", () => {
  beforeEach(() => {
    useShellStore.getState().reset();
  });

  it("starts with default state", () => {
    const state = useShellStore.getState();
    expect(state.activePanel).toBe("inbox");
    expect(state.mainSurface).toEqual({ kind: "conversation" });
    expect(state.selectedConversationId).toBeNull();
    expect(state.draftDirect).toBeNull();
    expect(state.isThreadOpen).toBe(false);
    expect(state.sidebarCollapsed).toBe(false);
    expect(state.editingMessageId).toBeNull();
    expect(state.highlightedMessageId).toBeNull();
    expect(state.activePluginPanel).toBeNull();
    expect(state.showNewChannelDialog).toBe(false);
    expect(state.showNewMessagePicker).toBe(false);
    expect(state.pinnedPanelOpen).toBe(false);
  });

  it("sets active panel", () => {
    useShellStore.getState().setActivePanel("plugins");
    expect(useShellStore.getState().activePanel).toBe("plugins");
  });

  it("sets main surface", () => {
    useShellStore.getState().setMainSurface({ kind: "settings" });
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "settings" });
  });

  it("sets main surface to settings with an optional tab hint", () => {
    useShellStore.getState().setMainSurface({ kind: "settings", tab: "plugins" });
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "settings", tab: "plugins" });
  });

  it("sets main surface to settings with keybinds tab hint", () => {
    useShellStore.getState().setMainSurface({ kind: "settings", tab: "keybinds" });
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "settings", tab: "keybinds" });
  });

  it("sets main surface to plugin with id", () => {
    useShellStore.getState().setMainSurface({ kind: "plugin", pluginId: "p1" });
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "plugin", pluginId: "p1" });
  });

  it("sets main surface to the audit log", () => {
    useShellStore.getState().setMainSurface({ kind: "audit-log" });
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "audit-log" });
  });

  it("selects a conversation and resets thread/editing state", () => {
    useShellStore.getState().openThreadForMessage("msg-1");
    useShellStore.getState().setEditingMessageId("edit-1");
    useShellStore.getState().setSelectedConversationId("conv-1");
    const state = useShellStore.getState();
    expect(state.selectedConversationId).toBe("conv-1");
    expect(state.isThreadOpen).toBe(false);
    expect(state.selectedRootMessageId).toBeNull();
    expect(state.editingMessageId).toBeNull();
  });

  it("opens a draft DM in place of the selected conversation, closing its thread", () => {
    useShellStore.getState().setSelectedConversationId("conv-1");
    useShellStore.getState().openThreadForMessage("msg-1");
    useShellStore.getState().openDraftDirect({ workspaceId: "ws-1", otherUserId: "u2" });
    const state = useShellStore.getState();
    expect(state.draftDirect).toEqual({ workspaceId: "ws-1", otherUserId: "u2" });
    expect(state.selectedConversationId).toBeNull();
    expect(state.isThreadOpen).toBe(false);
  });

  it("drops the draft DM when a conversation is selected", () => {
    useShellStore.getState().openDraftDirect({ workspaceId: "ws-1", otherUserId: "u2" });
    useShellStore.getState().setSelectedConversationId("conv-1");
    expect(useShellStore.getState().draftDirect).toBeNull();
    expect(useShellStore.getState().selectedConversationId).toBe("conv-1");
  });

  it("opens a thread for a message", () => {
    useShellStore.getState().openThreadForMessage("msg-1");
    const state = useShellStore.getState();
    expect(state.selectedRootMessageId).toBe("msg-1");
    expect(state.isThreadOpen).toBe(true);
  });

  it("closes a thread and records lastClosedThreadId", () => {
    useShellStore.getState().openThreadForMessage("msg-1");
    useShellStore.getState().closeThread();
    const state = useShellStore.getState();
    expect(state.isThreadOpen).toBe(false);
    expect(state.selectedRootMessageId).toBeNull();
    expect(state.lastClosedThreadId).toBe("msg-1");
  });

  it("toggles sidebar", () => {
    expect(useShellStore.getState().sidebarCollapsed).toBe(false);
    useShellStore.getState().toggleSidebar();
    expect(useShellStore.getState().sidebarCollapsed).toBe(true);
    useShellStore.getState().toggleSidebar();
    expect(useShellStore.getState().sidebarCollapsed).toBe(false);
  });

  it("opens a plugin panel", () => {
    useShellStore.getState().openPluginPanel("plugin-1", "panel-a", "main_area");
    const state = useShellStore.getState();
    expect(state.activePluginPanel).toEqual({
      pluginId: "plugin-1",
      panelId: "panel-a",
      slot: "main_area",
    });
    expect(state.mainSurface).toEqual({ kind: "conversation" });
  });

  it("closes a plugin panel", () => {
    useShellStore.getState().openPluginPanel("plugin-1", "panel-a", "tool_panel");
    useShellStore.getState().closePluginPanel();
    expect(useShellStore.getState().activePluginPanel).toBeNull();
  });

  it("closes a main-area plugin panel when a conversation or draft DM is opened", () => {
    const shell = () => useShellStore.getState();
    shell().openPluginPanel("plugin-1", "pods", "main_area");
    shell().setSelectedConversationId("conv-1");
    expect(shell().activePluginPanel).toBeNull();

    shell().openPluginPanel("plugin-1", "pods", "main_area");
    shell().openDraftDirect({ workspaceId: "ws-1", otherUserId: "u2" });
    expect(shell().activePluginPanel).toBeNull();
  });

  it("keeps a main-area plugin panel over selections the user did not make", () => {
    const shell = () => useShellStore.getState();
    shell().openPluginPanel("plugin-1", "pods", "main_area");
    shell().setSelectedConversationId(null);
    shell().setSelectedConversationId("conv-1", { keepPluginPanel: true });
    expect(shell().selectedConversationId).toBe("conv-1");
    expect(shell().activePluginPanel).toEqual({
      pluginId: "plugin-1",
      panelId: "pods",
      slot: "main_area",
    });
  });

  it("keeps a tool-panel plugin panel beside the conversation it opens", () => {
    const shell = () => useShellStore.getState();
    shell().openPluginPanel("plugin-1", "notes", "tool_panel");
    shell().setSelectedConversationId("conv-1");
    shell().openDraftDirect({ workspaceId: "ws-1", otherUserId: "u2" });
    expect(shell().activePluginPanel).toEqual({
      pluginId: "plugin-1",
      panelId: "notes",
      slot: "tool_panel",
    });
  });

  it("sets focused surface", () => {
    useShellStore.getState().setFocusedSurface("composer");
    expect(useShellStore.getState().focusedSurface).toBe("composer");
  });

  it("sets editing message id", () => {
    useShellStore.getState().setEditingMessageId("msg-1");
    expect(useShellStore.getState().editingMessageId).toBe("msg-1");
  });

  it("sets highlighted message id", () => {
    useShellStore.getState().setHighlightedMessageId("msg-2");
    expect(useShellStore.getState().highlightedMessageId).toBe("msg-2");
  });

  it("sets showNewChannelDialog", () => {
    useShellStore.getState().setShowNewChannelDialog(true);
    expect(useShellStore.getState().showNewChannelDialog).toBe(true);
  });

  it("sets showNewMessagePicker", () => {
    useShellStore.getState().setShowNewMessagePicker(true);
    expect(useShellStore.getState().showNewMessagePicker).toBe(true);
  });

  it("sets pinnedPanelOpen", () => {
    useShellStore.getState().setPinnedPanelOpen(true);
    expect(useShellStore.getState().pinnedPanelOpen).toBe(true);
  });

  it("resets to default state", () => {
    useShellStore.getState().setSelectedConversationId("conv-1");
    useShellStore.getState().openThreadForMessage("msg-1");
    useShellStore.getState().toggleSidebar();
    useShellStore.getState().openDraftDirect({ workspaceId: "ws-1", otherUserId: "u2" });
    useShellStore.getState().reset();
    const state = useShellStore.getState();
    expect(state.selectedConversationId).toBeNull();
    expect(state.draftDirect).toBeNull();
    expect(state.isThreadOpen).toBe(false);
    expect(state.sidebarCollapsed).toBe(false);
  });
});
