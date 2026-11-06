import { useQueries } from "@tanstack/react-query";

import { NotificationReason } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import {
  fetchNotificationPage,
  type NotificationItem,
} from "../../notifications/api/useNotifications";
import { useBlockedConversations } from "../../relay/state/useBlockedConversations";
import type { HomeWorkspace } from "./useHomeWorkspaces";
import { useHomeWorkspaces } from "./useHomeWorkspaces";

const POLL_MS = 60_000;
const FETCH_LIMIT = 100;

/** The reasons Home lists: someone named the person, or answered in a thread they are in. */
const HOME_REASONS: ReadonlySet<NotificationReason> = new Set([
  NotificationReason.MENTION,
  NotificationReason.THREAD_REPLY,
]);

/** A workspace whose mentions could not be loaded. */
export interface FailedWorkspace {
  workspace: HomeWorkspace;
  retry: () => void;
}

/** What {@link useHomeMentions} found across the workspaces. */
export interface HomeMentions {
  /** The unread mentions and replies of every workspace that answered, newest first. */
  items: NotificationItem[];
  failed: FailedWorkspace[];
  /** No workspace has answered yet. */
  isPending: boolean;
}

/**
 * The unread mentions and thread replies of every workspace of the account, newest first. Each
 * workspace is asked at its own host and polled every minute; the open workspace's events
 * refresh its list at once. A workspace that fails is reported apart and the others still show.
 * The lists sit under the notification inbox's cache key, so marking an entry read refreshes them.
 *
 * @param only - A workspace to restrict the result to, or null for all.
 */
export function useHomeMentions(only: string | null = null): HomeMentions {
  const { workspaces } = useHomeWorkspaces();
  const blocked = useBlockedConversations((s) => s.bySpace);
  const results = useQueries({
    queries: workspaces.map((workspace) => ({
      queryKey: queryKeys.homeMentions(workspace.id),
      staleTime: POLL_MS,
      refetchInterval: POLL_MS,
      refetchOnWindowFocus: true,
      retry: 1,
      queryFn: async () => {
        const page = await fetchNotificationPage(workspace.id, true, null, FETCH_LIMIT);
        return page.items.filter((item) => HOME_REASONS.has(item.reason));
      },
    })),
  });
  const items: NotificationItem[] = [];
  const failed: FailedWorkspace[] = [];
  let pending = 0;
  let answered = 0;
  workspaces.forEach((workspace, index) => {
    if (only !== null && workspace.id !== only) return;
    const result = results[index];
    if (!result) return;
    if (result.isPending) pending += 1;
    else answered += 1;
    if (result.isError) failed.push({ workspace, retry: () => void result.refetch() });
    for (const item of result.data ?? []) {
      if (blocked[workspace.id]?.[item.conversationId]) continue;
      items.push(item);
    }
  });
  items.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return { items, failed, isPending: pending > 0 && answered === 0 };
}

/** How many unread mentions and replies the account has across its workspaces. */
export function useHomeMentionCount(): number {
  return useHomeMentions().items.length;
}
