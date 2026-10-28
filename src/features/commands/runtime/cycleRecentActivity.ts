import type { InfiniteData } from "@tanstack/react-query";

import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { toast } from "../../../shared/toast";
import { useShellStore } from "../../../shell/state/useShellStore";
import { selectDirectConversation } from "../../conversations/state/directSelection";
import {
  useRecentActivityStore,
  type RecentActivityEntry,
} from "../../conversations/state/useRecentActivityStore";
import { isDirectSpace } from "../../relay/state/useRelayStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";

/** Runs this close together walk further back through the log instead of starting over. */
export const RECENT_ACTIVITY_WALK_MS = 5000;

interface Walk {
  /** Index in the log of the entry the last run jumped to. */
  position: number;
  at: number;
  revision: number;
}

let walk: Walk | null = null;

/** Forgets the walk through the log. */
export function resetRecentActivityWalk(): void {
  walk = null;
}

/** The id of the root message of thread `threadId`, when a cached read of it knows. */
function rootMessageOf(entry: RecentActivityEntry): string | null {
  if (!entry.threadId) return null;
  const { workspaceId, conversationId, threadId } = entry;
  const byRoot = queryClient.getQueriesData<{ id: string; rootMessageId: string } | null>({
    queryKey: ["threadByRoot", workspaceId, conversationId],
  });
  const thread = byRoot.find(([, data]) => data?.id === threadId)?.[1];
  if (thread) return thread.rootMessageId;
  const pages = queryClient.getQueryData<
    InfiniteData<{ items: { id: string; rootThreadId?: string | null }[] }>
  >(queryKeys.messages(workspaceId, conversationId))?.pages;
  for (const page of pages ?? []) {
    const root = page.items.find((m) => m.rootThreadId === threadId);
    if (root) return root.id;
  }
  return null;
}

/** True when the entry is the place the user is in now. */
function isCurrent(entry: RecentActivityEntry): boolean {
  const shell = useShellStore.getState();
  if (
    entry.workspaceId !== useWorkspaceStore.getState().workspaceId ||
    entry.conversationId !== shell.selectedConversationId
  ) {
    return false;
  }
  if (!entry.threadId) return true;
  const root = rootMessageOf(entry);
  return shell.isThreadOpen && root !== null && root === shell.selectedRootMessageId;
}

function open(entry: RecentActivityEntry): void {
  if (isDirectSpace(entry.workspaceId)) {
    selectDirectConversation(entry.workspaceId, entry.conversationId);
  } else {
    if (useWorkspaceStore.getState().workspaceId !== entry.workspaceId) {
      useWorkspaceStore.getState().setWorkspaceId(entry.workspaceId);
    }
    useShellStore.getState().setSelectedConversationId(entry.conversationId);
  }
  // Selecting a conversation closes the thread pane, so the thread opens after it.
  const root = rootMessageOf(entry);
  if (root) useShellStore.getState().openThreadForMessage(root);
}

/**
 * Jumps to the next place in the recent-activity log, newest first, skipping the place the user
 * is in. Runs within {@link RECENT_ACTIVITY_WALK_MS} of each other walk further back; a longer
 * pause, or a message that arrived since, starts at the newest again.
 */
export function cycleRecentActivity(now: number = Date.now()): void {
  const { entries, revision } = useRecentActivityStore.getState();
  const continuing =
    walk !== null && now - walk.at < RECENT_ACTIVITY_WALK_MS && walk.revision === revision;
  const start = continuing && walk ? walk.position + 1 : 0;
  for (let step = 0; step < entries.length; step++) {
    const index = (start + step) % entries.length;
    if (isCurrent(entries[index])) continue;
    walk = { position: index, at: now, revision };
    open(entries[index]);
    return;
  }
  walk = null;
  toast.info("No recent activity", { duration: 1500 });
}
