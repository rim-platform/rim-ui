import { useMutation, useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import { queryClient } from "../../../core/query/queryClient";
import { toast } from "../../../shared/toast";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { invalidateUnreadNotificationCount } from "../../notifications/api/useNotifications";
import { useUnreadStore, type CountSnapshot } from "../state/useUnreadStore";

const MARK_AS_READ = gql`
  mutation MarkAsRead($input: MarkAsReadInput!) {
    markAsRead(input: $input)
  }
`;

export const MARK_ALL_AS_READ = gql`
  mutation MarkAllAsRead($input: MarkAllAsReadInput!) {
    markAllAsRead(input: $input)
  }
`;

/** How long marking everything read can be undone before the server is told. */
export const MARK_ALL_UNDO_MS = 6000;

interface PendingMarkAll {
  userId: string | undefined;
  /** What each space's counts were, from the first run of the wait on. */
  snapshots: Map<string, CountSnapshot>;
  timer: ReturnType<typeof setTimeout>;
  toastId: string;
}

let pendingMarkAll: PendingMarkAll | null = null;
let markAllRuns = 0;

/** `earlier` with what `later` adds: their counts summed, and the older marker of each. */
function unionOf(earlier: CountSnapshot | undefined, later: CountSnapshot): CountSnapshot {
  if (!earlier) return later;
  const counts = { ...earlier.counts };
  for (const [conversationId, count] of Object.entries(later.counts)) {
    counts[conversationId] = (counts[conversationId] ?? 0) + count;
  }
  return { counts, markers: { ...later.markers, ...earlier.markers } };
}

function refetchCounts(spaceId: string): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.unreadCounts(spaceId) });
}

function takePendingMarkAll(): PendingMarkAll | null {
  const pending = pendingMarkAll;
  if (!pending) return null;
  pendingMarkAll = null;
  clearTimeout(pending.timer);
  return pending;
}

/**
 * Sends what is waiting to be marked read, for the spaces of the wait now running. Their counts
 * are read again once the server has answered, whichever way it did. Nothing is sent when the
 * account changed during the wait.
 */
export function sendPendingMarkAll(): void {
  const pending = takePendingMarkAll();
  if (!pending) return;
  toast.dismiss(pending.toastId);
  const sameAccount = pending.userId === useAuthStore.getState().session?.userId;
  for (const workspaceId of pending.snapshots.keys()) {
    const sent = sameAccount
      ? graphqlClient.request(MARK_ALL_AS_READ, { input: { workspaceId } })
      : Promise.resolve();
    void sent
      .catch(() => {
        toast.error("Failed to mark all as read");
      })
      .finally(() => {
        useUnreadStore.getState().endMarkAll(workspaceId);
        refetchCounts(workspaceId);
      });
  }
}

/** Puts back what the wait now running cleared, and sends nothing. */
function undoPendingMarkAll(): void {
  const pending = takePendingMarkAll();
  if (!pending) return;
  for (const [workspaceId, snapshot] of pending.snapshots) {
    useUnreadStore.getState().endMarkAll(workspaceId, snapshot);
    refetchCounts(workspaceId);
  }
}

/**
 * Clears a workspace's unread counts at once and offers to undo that. The server is told only
 * when {@link MARK_ALL_UNDO_MS} pass, so closing the app before then marks nothing. A later read
 * of the counts does not bring the badges back meanwhile. Running this again during the wait
 * starts it over with both runs' conversations, also across workspaces.
 */
export function markWorkspaceRead(workspaceId: string): void {
  const taken = useUnreadStore.getState().beginMarkAll(workspaceId);
  const previous = takePendingMarkAll();
  if (previous) toast.dismiss(previous.toastId);
  const snapshots = new Map(previous?.snapshots);
  snapshots.set(workspaceId, unionOf(snapshots.get(workspaceId), taken));
  const toastId = `mark-all-read-${++markAllRuns}`;
  pendingMarkAll = {
    userId: useAuthStore.getState().session?.userId,
    snapshots,
    timer: setTimeout(sendPendingMarkAll, MARK_ALL_UNDO_MS),
    toastId,
  };
  toast.success("All conversations marked as read", {
    id: toastId,
    duration: MARK_ALL_UNDO_MS,
    action: { label: "Undo", onClick: undoPendingMarkAll },
  });
}

interface MarkAsReadInput {
  conversationId: string;
  workspaceId: string;
  readAt: string;
}

export function useMarkAsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: MarkAsReadInput) => {
      return graphqlClient.request<{ markAsRead: boolean }>(MARK_AS_READ, {
        input,
      });
    },
    onMutate: (input) => {
      useUnreadStore.getState().markRead(input.conversationId);
    },
    // Reading a conversation also marks its notifications read on the server.
    onSuccess: (_data, input) => {
      invalidateUnreadNotificationCount(qc, input.workspaceId);
    },
  });
}
