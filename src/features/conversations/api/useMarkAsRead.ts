import { useMutation, useQueryClient } from "@tanstack/react-query";

import { graphqlClient } from "../../../core/graphql/client";
import { invalidateUnreadNotificationCount } from "../../notifications/api/useNotifications";
import { useUnreadStore } from "../state/useUnreadStore";
import { deferMark, MARK_AS_READ, sendDeferredMarkOf } from "./deferredMark";

/** How long marking everything read can be undone before the server is told. */
export const MARK_ALL_UNDO_MS = 6000;

const MARK_ALL_KEY = "mark-all";

/** Sends what the wait of marking everything read now holds. */
export function sendPendingMarkAll(): void {
  sendDeferredMarkOf(MARK_ALL_KEY);
}

/**
 * Clears a workspace's unread counts at once and offers to undo that. The server is told only
 * when {@link MARK_ALL_UNDO_MS} pass, so closing the app before then marks nothing. A later read
 * of the counts does not bring the badges back meanwhile. Running this again during the wait
 * starts it over with both runs' conversations, also across workspaces.
 */
export function markWorkspaceRead(workspaceId: string): void {
  deferMark({
    targets: [{ kind: "workspace", workspaceId }],
    waitMs: MARK_ALL_UNDO_MS,
    mergeKey: MARK_ALL_KEY,
    toastTitle: "All conversations marked as read",
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
