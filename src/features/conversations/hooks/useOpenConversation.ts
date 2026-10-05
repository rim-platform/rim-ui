import { useCallback } from "react";

import { useShellStore } from "../../../shell/state/useShellStore";

/** Selects a conversation and brings the conversation surface forward in compose mode. */
export function useOpenConversation() {
  return useCallback((conversationId: string) => {
    const shell = useShellStore.getState();
    shell.setMainSurface({ kind: "conversation" });
    shell.setSelectedConversationId(conversationId);
    shell.setNavigationMode(false);
  }, []);
}
