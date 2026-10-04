import { useShellStore } from "../../../shell/state/useShellStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { registerTool } from "./registry";

// Documented carve-out — the ONE hardcoded AI tool that stays after the
// Phase 4 deletion of `tools/builtins/`. Rationale per the Phase 4 migration
// matrix (`rim-server/docs/design/phase4-tool-migration-matrix.md` row #4):
// `get_current_context` reads FE runtime state (Zustand stores) that has no
// backend analogue. A backend mirror would just echo `commandContext` back.
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
