import type { CommandContextInput } from "../types";
import { useShellStore } from "../../../shell/state/useShellStore";
import { openThreadId } from "../../threads/api/openThreadId";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";

/** A message a surface acts on in place of the open conversation, as a context menu does. */
export interface CommandContextTarget {
  workspaceId: string;
  conversationId: string;
  /** The message's thread, when it has one. */
  threadId?: string;
  selectedMessageId?: string;
}

/**
 * The context a command runs in, as `executeCommand` takes it in `commandContext`: the selected
 * workspace, the open conversation, the thread open beside it and the focused surface. `threadId`
 * is the thread's own id and is left out until the open thread exists and has loaded. A `target`
 * replaces the workspace, conversation and thread with its own and adds its message; the focused
 * surface stays. The selected text and the active panel are never set, as no store holds them.
 *
 * @param target - The message the surface acts on, when it names one.
 * @returns The context with only its known fields set; empty when no workspace is selected and
 *   no target is given.
 */
export function currentCommandContext(target?: CommandContextTarget): CommandContextInput {
  const shell = useShellStore.getState();
  const workspaceId = target?.workspaceId ?? useWorkspaceStore.getState().workspaceId;
  if (!workspaceId) return {};

  const ctx: CommandContextInput = { workspaceId };
  if (target) {
    ctx.conversationId = target.conversationId;
    if (target.threadId) ctx.threadId = target.threadId;
    if (target.selectedMessageId) ctx.selectedMessageId = target.selectedMessageId;
  } else if (shell.selectedConversationId) {
    ctx.conversationId = shell.selectedConversationId;
    const threadId = openThreadId(workspaceId, shell.selectedConversationId);
    if (threadId) ctx.threadId = threadId;
  }
  if (shell.focusedSurface) {
    ctx.focusedSurface = shell.focusedSurface;
  }

  return ctx;
}
