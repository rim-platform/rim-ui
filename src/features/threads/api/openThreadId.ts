import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { useShellStore } from "../../../shell/state/useShellStore";

/**
 * The id of the thread open in the thread pane, read from its loaded `threadByRoot` query: the
 * thread's own id, which commands and `rim.chat.post_message` take, never its root message's.
 *
 * @param workspaceId - The workspace the thread pane's query was made in.
 * @param conversationId - The conversation the thread belongs to.
 * @returns The thread id, or `undefined` while no thread is open, the root message has no
 *   thread yet, or its query has not loaded.
 */
export function openThreadId(
  workspaceId: string | undefined,
  conversationId: string,
): string | undefined {
  const shell = useShellStore.getState();
  if (!shell.isThreadOpen || !shell.selectedRootMessageId) return undefined;
  const thread = queryClient.getQueryData<{ id: string } | null>(
    queryKeys.threadByRoot(workspaceId, conversationId, shell.selectedRootMessageId),
  );
  return thread?.id ?? undefined;
}
