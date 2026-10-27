import { useMembersPanelStore } from "../../features/conversations/state/useMembersPanelStore";
import { useNotificationsPanelStore } from "../../features/notifications/state/useNotificationsPanelStore";
import { useMemberDirectoryStore } from "../../features/workspaces/state/useMemberDirectoryStore";
import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";
import { useShellStore } from "./useShellStore";

/** The close action of the panel in front, or `null` when no panel is open. */
function topPanelClose(): (() => void) | null {
  const shell = useShellStore.getState();
  const { workspaceId } = useWorkspaceStore.getState();
  const onConversation = shell.mainSurface.kind === "conversation";
  // A main-area plugin panel covers the conversation, and the thread beside it.
  if (onConversation && shell.activePluginPanel?.slot === "main_area") {
    return shell.closePluginPanel;
  }
  if (shell.isThreadOpen) return shell.closeThread;
  if (!onConversation) return () => shell.setMainSurface({ kind: "conversation" });
  if (shell.activePluginPanel) return shell.closePluginPanel;
  const notifications = useNotificationsPanelStore.getState();
  if (notifications.open && workspaceId) return () => notifications.setOpen(false);
  const members = useMembersPanelStore.getState();
  if (members.open && workspaceId && shell.selectedConversationId) {
    return () => members.setOpen(false);
  }
  const directory = useMemberDirectoryStore.getState();
  if (directory.open && workspaceId) return () => directory.setOpen(false);
  return null;
}

/**
 * Whether Escape has a panel to close: a plugin panel, the thread, a page in place of the
 * conversation, or the notifications or a members list in the tool panel.
 */
export function hasPanelToClose(): boolean {
  return topPanelClose() !== null;
}

/**
 * Closes the panel in front and returns whether one closed.
 *
 * @returns `false` when no panel was open.
 */
export function closeTopPanel(): boolean {
  const close = topPanelClose();
  close?.();
  return close !== null;
}
