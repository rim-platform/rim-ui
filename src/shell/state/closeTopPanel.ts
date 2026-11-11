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
  // The navigation drawer of a narrow window sits in front of everything else.
  if (shell.navDrawerOpen && !shell.zenMode) return () => shell.setNavDrawerOpen(false);
  // The notification inbox opens under the top bar, over every page.
  const notifications = useNotificationsPanelStore.getState();
  if (notifications.open && workspaceId) return () => notifications.setOpen(false);
  // A main-area plugin panel takes the page's place, and covers the thread beside it.
  if (shell.activePluginPanel?.slot === "main_area") return shell.closePluginPanel;
  if (shell.isThreadOpen) return shell.closeThread;
  // Beside the conversation the pinned panel has no Escape; over it, it closes like the thread.
  if (onConversation && shell.shellWidth !== "wide" && shell.pinnedPanelOpen) {
    return () => shell.setPinnedPanelOpen(false);
  }
  if (onConversation && shell.shellWidth !== "wide" && shell.botsPanelOpen) {
    return () => shell.setBotsPanelOpen(false);
  }
  if (!onConversation) return () => shell.setMainSurface({ kind: "conversation" });
  if (shell.activePluginPanel) return shell.closePluginPanel;
  const members = useMembersPanelStore.getState();
  if (members.open && workspaceId && shell.selectedConversationId) {
    return () => members.setOpen(false);
  }
  const directory = useMemberDirectoryStore.getState();
  if (directory.open && workspaceId) return () => directory.setOpen(false);
  return null;
}

/**
 * Whether Escape has a panel to close: the notification inbox, a plugin panel, the thread, a
 * page in place of the conversation, or a members list in the tool panel.
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
