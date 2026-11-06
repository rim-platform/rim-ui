import { useMemo } from "react";

import { useUnreadStore } from "../../conversations/state/useUnreadStore";
import type { HomeWorkspace } from "./useHomeWorkspaces";

/** A workspace's unread messages. */
export interface WorkspaceUnread {
  workspace: HomeWorkspace;
  messages: number;
  conversations: number;
}

/**
 * The workspaces that have unread messages, with how many messages in how many conversations,
 * from the counts the unread store holds. Muted conversations count here as they do on the
 * workspace rail.
 *
 * @param workspaces - The workspaces to look at, in the order to list them.
 */
export function useHomeUnread(workspaces: readonly HomeWorkspace[]): WorkspaceUnread[] {
  const counts = useUnreadStore((s) => s.counts);
  const spaceOf = useUnreadStore((s) => s.spaceOf);
  return useMemo(() => {
    const result: WorkspaceUnread[] = [];
    for (const workspace of workspaces) {
      let messages = 0;
      let conversations = 0;
      for (const [conversationId, count] of Object.entries(counts)) {
        if (count > 0 && spaceOf[conversationId] === workspace.id) {
          messages += count;
          conversations += 1;
        }
      }
      if (messages > 0) result.push({ workspace, messages, conversations });
    }
    return result;
  }, [workspaces, counts, spaceOf]);
}
