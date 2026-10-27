import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useMembersPanelStore } from "../../features/conversations/state/useMembersPanelStore";
import { useNotificationsPanelStore } from "../../features/notifications/state/useNotificationsPanelStore";
import { useMemberDirectoryStore } from "../../features/workspaces/state/useMemberDirectoryStore";
import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";
import { closeTopPanel, hasPanelToClose } from "./closeTopPanel";
import { useShellStore } from "./useShellStore";

describe("closeTopPanel", () => {
  beforeEach(() => {
    useShellStore.getState().reset();
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
    useNotificationsPanelStore.getState().setOpen(false);
    useMembersPanelStore.getState().setOpen(false);
    useMemberDirectoryStore.getState().setOpen(false);
  });

  it("closes one panel per call, the one in front first, and reports when none is left", () => {
    const shell = () => useShellStore.getState();
    shell().setSelectedConversationId("conv-1");
    shell().openThreadForMessage("root-1");
    shell().openPluginPanel("chat.rim.github-prs", "prs", "tool_panel");
    useNotificationsPanelStore.getState().setOpen(true);
    useMembersPanelStore.getState().setOpen(true);
    useMemberDirectoryStore.getState().setOpen(true);

    expect(hasPanelToClose()).toBe(true);
    expect(closeTopPanel()).toBe(true);
    expect(shell().isThreadOpen).toBe(false);
    expect(shell().activePluginPanel).not.toBeNull();

    expect(closeTopPanel()).toBe(true);
    expect(shell().activePluginPanel).toBeNull();
    expect(useNotificationsPanelStore.getState().open).toBe(true);

    expect(closeTopPanel()).toBe(true);
    expect(useNotificationsPanelStore.getState().open).toBe(false);
    expect(useMembersPanelStore.getState().open).toBe(true);

    expect(closeTopPanel()).toBe(true);
    expect(useMembersPanelStore.getState().open).toBe(false);
    expect(useMemberDirectoryStore.getState().open).toBe(true);

    expect(closeTopPanel()).toBe(true);
    expect(useMemberDirectoryStore.getState().open).toBe(false);

    expect(closeTopPanel()).toBe(false);
    expect(hasPanelToClose()).toBe(false);
  });
});
