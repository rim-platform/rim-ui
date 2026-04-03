import { useShellStore } from "../../../../shell/state/useShellStore";
import { useWorkspaceStore } from "../../../workspaces/state/useWorkspaceStore";
import { registerTool } from "../registry";

export function registerGetCurrentContextTool(): void {
  registerTool(
    {
      name: "get_current_context",
      description: "Get the user's current context: which workspace and conversation they are viewing.",
      input_schema: {
        type: "object",
        properties: {},
      },
    },
    async () => {
      const workspaceId = useWorkspaceStore.getState().workspaceId;
      const conversationId = useShellStore.getState().selectedConversationId;
      const isThreadOpen = useShellStore.getState().isThreadOpen;
      const rootMessageId = useShellStore.getState().selectedRootMessageId;

      return JSON.stringify({
        workspaceId,
        conversationId,
        isThreadOpen,
        rootMessageId,
      });
    },
  );
}
