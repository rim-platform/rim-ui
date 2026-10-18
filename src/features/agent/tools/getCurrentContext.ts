import { useShellStore } from "../../../shell/state/useShellStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { registerTool } from "./registry";

/**
 * Registers `get_current_context`, the one AI tool defined in the client
 * rather than generated from a backend command. It reads client state (the
 * workspace and shell stores) that has no backend counterpart; a backend
 * command would only echo `commandContext` back.
 */
export function registerGetCurrentContextTool(): void {
  registerTool(
    {
      name: "get_current_context",
      description:
        "Get the user's current context: which workspace and conversation they are viewing.",
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
