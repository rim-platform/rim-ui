import { useShellStore } from "../../../shell/state/useShellStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import type { SearchMessageItem } from "../api/useSearchMessages";

/**
 * Opens a search result: its workspace when another one is open, its conversation, and the
 * message highlighted there, or in its thread for a reply.
 *
 * @param message - The result to open.
 */
export function openSearchResult(message: SearchMessageItem): void {
  const workspaces = useWorkspaceStore.getState();
  if (message.serverId && workspaces.workspaceId !== message.serverId) {
    workspaces.setWorkspaceId(message.serverId);
  }
  const shell = useShellStore.getState();
  shell.setMainSurface({ kind: "conversation" });
  shell.setSelectedConversationId(message.conversationId);
  if (message.rootMessageId) shell.openThreadForMessage(message.rootMessageId);
  shell.setHighlightedMessageId(message.id);
}
