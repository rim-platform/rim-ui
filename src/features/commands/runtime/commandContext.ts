import type { CommandContextInput } from "../types";
import { useShellStore } from "../../../shell/state/useShellStore";
import { openThreadId } from "../../threads/api/openThreadId";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useSelectedMessageStore } from "../../messages/state/useSelectedMessageStore";

/**
 * What a surface acts on in place of the open conversation, as a context menu or a row does: a
 * workspace, a conversation in it, or a message there.
 */
export interface CommandContextTarget {
  workspaceId: string;
  /** The conversation; left out for a control that acts on the workspace itself. */
  conversationId?: string;
  /** The message's thread, when it has one. */
  threadId?: string;
  selectedMessageId?: string;
}

/**
 * The context a command runs in, as `executeCommand` takes it in `commandContext`: the selected
 * workspace, the open conversation, the thread open beside it, the message selected in that
 * conversation's message list and the focused surface. `threadId` is the thread's own id and is
 * left out until the open thread exists and has loaded; the selected message is left out when it
 * is in another workspace or conversation. A `target` replaces the workspace, conversation,
 * thread and selected message with its own; the focused surface stays. The selected text and the
 * active panel are never set, as no store holds them.
 *
 * @param target - The workspace, conversation or message the surface acts on, when it names one.
 * @returns The context with only its known fields set; empty when no workspace is selected and
 *   no target is given.
 */
export function currentCommandContext(target?: CommandContextTarget): CommandContextInput {
  const shell = useShellStore.getState();
  const workspaceId = target?.workspaceId ?? useWorkspaceStore.getState().workspaceId;
  if (!workspaceId) return {};

  const ctx: CommandContextInput = { workspaceId };
  if (target) {
    if (target.conversationId) ctx.conversationId = target.conversationId;
    if (target.threadId) ctx.threadId = target.threadId;
    if (target.selectedMessageId) ctx.selectedMessageId = target.selectedMessageId;
  } else if (shell.selectedConversationId) {
    ctx.conversationId = shell.selectedConversationId;
    const threadId = openThreadId(workspaceId, shell.selectedConversationId);
    if (threadId) ctx.threadId = threadId;
    const selection = useSelectedMessageStore.getState().selection;
    if (
      selection &&
      selection.workspaceId === workspaceId &&
      selection.conversationId === shell.selectedConversationId
    ) {
      ctx.selectedMessageId = selection.messageId;
    }
  }
  if (shell.focusedSurface) {
    ctx.focusedSurface = shell.focusedSurface;
  }

  return ctx;
}
