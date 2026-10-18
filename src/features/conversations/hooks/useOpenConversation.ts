import { useCallback } from "react";

import { useShellStore } from "../../../shell/state/useShellStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";

/**
 * Selects a conversation and brings the conversation surface forward in compose mode. Given
 * the conversation's `workspaceId`, it switches to that workspace first when another is open.
 */
export function useOpenConversation() {
  return useCallback((conversationId: string, workspaceId?: string) => {
    const workspaces = useWorkspaceStore.getState();
    if (workspaceId && workspaces.workspaceId !== workspaceId) {
      workspaces.setWorkspaceId(workspaceId);
    }
    const shell = useShellStore.getState();
    shell.setMainSurface({ kind: "conversation" });
    shell.setSelectedConversationId(conversationId);
    shell.setNavigationMode(false);
  }, []);
}
