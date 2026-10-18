import type { CommandContextInput } from "../../../core/graphql/generated/schema-types";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";

/**
 * Snapshot the current shell/workspace state into a `CommandContextInput`
 * suitable for `executeCommand`'s `commandContext` field. Returns null when
 * no workspace is selected — backend treats omitted context as "agent in
 * unknown surface" and skips the audit-log enrichment.
 *
 * Mapping:
 *   workspaceId      ← useWorkspaceStore.workspaceId
 *   conversationId   ← useShellStore.selectedConversationId
 *   threadId         ← useShellStore.selectedRootMessageId  (only when isThreadOpen)
 *   focusedSurface   ← useShellStore.focusedSurface         (free-form string)
 *
 * `selectedMessageId(s)`, `selectedText`, and `activePanel` stay unset:
 * the shell store has no source for them.
 */
export function getCurrentCommandContext(): CommandContextInput | null {
  const workspaceId = useWorkspaceStore.getState().workspaceId;
  if (!workspaceId) return null;

  const shell = useShellStore.getState();
  const ctx: CommandContextInput = { workspaceId };

  if (shell.selectedConversationId) {
    ctx.conversationId = shell.selectedConversationId;
  }
  if (shell.isThreadOpen && shell.selectedRootMessageId) {
    ctx.threadId = shell.selectedRootMessageId;
  }
  if (shell.focusedSurface) {
    ctx.focusedSurface = shell.focusedSurface;
  }

  return ctx;
}
