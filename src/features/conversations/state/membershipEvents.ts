import type { QueryClient } from "@tanstack/react-query";

import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { toast } from "../../../shared/toast";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { invalidateConversationQueries } from "../api/useChannelMembership";
import { findCachedConversation } from "../api/useConversation";
import type { ConversationSummary, ConversationSummaryPage } from "../types";
import { conversationLabel } from "../utils";
import { isLeaving } from "./pendingLeaves";
import { useMembersPanelStore } from "./useMembersPanelStore";

/**
 * Realtime handlers for conversation membership and archive events, called from
 * `useWorkspaceEvents`. They keep the sidebar lists, the open conversation and its members
 * panel in step with the server.
 */

function currentUserId(qc: QueryClient): string | undefined {
  return (
    useAuthStore.getState().session?.userId ?? qc.getQueryData<{ id: string }>(queryKeys.me)?.id
  );
}

function dropFromList(qc: QueryClient, key: readonly unknown[], conversationId: string): void {
  qc.setQueryData<ConversationSummaryPage>(key, (old) =>
    old ? { ...old, items: old.items.filter((c) => c.id !== conversationId) } : old,
  );
}

/**
 * Someone joined the workspace: the server added them to every public channel, so refresh the
 * channel lists and each public channel's own query, whose member count and ids changed.
 */
export function handleWorkspaceMemberJoined(qc: QueryClient, workspaceId: string): void {
  qc.invalidateQueries({ queryKey: queryKeys.channels(workspaceId) });
  qc.invalidateQueries({
    queryKey: ["conversation", workspaceId],
    predicate: (query) => {
      const conversation = query.state.data as ConversationSummary | undefined;
      return (
        conversation?.conversationType === ConversationTypeEnum.CHANNEL && !conversation.isPrivate
      );
    },
  });
}

/** Someone (possibly the viewer) joined or was invited: refresh the lists and the members. */
export function handleMemberAddedToConversation(
  qc: QueryClient,
  workspaceId: string,
  conversationId: string,
): void {
  invalidateConversationQueries(qc, workspaceId, conversationId);
}

/**
 * Someone left or was removed. For the viewer, the conversation leaves the sidebar at once and,
 * if it is open, the shell returns to the workspace home with a toast (unless the viewer is
 * leaving on purpose, which shows its own toast).
 */
export function handleMemberRemovedFromConversation(
  qc: QueryClient,
  workspaceId: string,
  conversationId: string,
  userId: string,
): void {
  if (userId !== currentUserId(qc)) {
    invalidateConversationQueries(qc, workspaceId, conversationId);
    return;
  }

  const cached = findCachedConversation(qc, workspaceId, conversationId);
  dropFromList(qc, queryKeys.joinedChannels(workspaceId), conversationId);
  dropFromList(qc, queryKeys.conversations(workspaceId), conversationId);

  const shell = useShellStore.getState();
  if (shell.selectedConversationId === conversationId) {
    useMembersPanelStore.getState().setOpen(false);
    shell.setSelectedConversationId(null);
    if (!isLeaving(conversationId)) {
      const label = cached ? conversationLabel(cached) : "this conversation";
      toast.info(`You are no longer a member of ${label}`);
    }
  }

  invalidateConversationQueries(qc, workspaceId, conversationId);
}

/** Topic or archive state changed: refetch the conversation and the lists that show it. */
export function handleConversationUpdated(
  qc: QueryClient,
  workspaceId: string,
  conversationId: string,
): void {
  qc.invalidateQueries({ queryKey: queryKeys.conversation(workspaceId, conversationId) });
  qc.invalidateQueries({ queryKey: queryKeys.channels(workspaceId) });
}
