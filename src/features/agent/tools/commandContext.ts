import type { CommandContextInput } from "../../../core/graphql/generated/schema-types";
import { useShellStore } from "../../../shell/state/useShellStore";
import { openThreadId } from "../../threads/api/openThreadId";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";

/**
 * The agent's current context as `executeCommand` takes it in `commandContext`: the workspace,
 * the open conversation, the thread open beside it and the focused surface. `threadId` is the
 * thread's own id, read the same way a plugin command's is, and is left out until the open
 * thread exists and has loaded. The selected message, selected text and active panel are never
 * set, as the shell store holds none of them.
 *
 * @returns The context, or `null` when no workspace is selected.
 */
export function getCurrentCommandContext(): CommandContextInput | null {
  const workspaceId = useWorkspaceStore.getState().workspaceId;
  if (!workspaceId) return null;

  const shell = useShellStore.getState();
  const ctx: CommandContextInput = { workspaceId };

  if (shell.selectedConversationId) {
    ctx.conversationId = shell.selectedConversationId;
    const threadId = openThreadId(workspaceId, shell.selectedConversationId);
    if (threadId) ctx.threadId = threadId;
  }
  if (shell.focusedSurface) {
    ctx.focusedSurface = shell.focusedSurface;
  }

  return ctx;
}
