import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { MESSAGES_QUERY } from "../../../core/graphql/queries";
import { queryKeys } from "../../../core/query/keys";
import { queryClient } from "../../../core/query/queryClient";
import type { MessagesPage } from "../../../core/types/messages";
import { toast } from "../../../shared/toast";
import { isTimelineNotice } from "../../e2ee/utils/timeline";
import { holdIfOpen } from "../state/useUnreadEventHandler";
import { useUnreadStore } from "../state/useUnreadStore";

const MARK_AS_UNREAD = gql`
  mutation MarkAsUnread($input: MarkAsUnreadInput!) {
    markAsUnread(input: $input)
  }
`;

const FIRST_PAGE_SIZE = 50;

interface MarkAsUnreadInput {
  workspaceId: string;
  conversationId: string;
  messageId: string;
}

/** Whether a space's host has read markers, as its last count read showed; false until one has. */
export function spaceMarksUnread(spaceId: string): boolean {
  return useUnreadStore.getState().countSources[spaceId] === "markers";
}

/** {@link spaceMarksUnread} for a component. */
export function useSpaceMarksUnread(spaceId: string | null): boolean {
  return useUnreadStore((s) => (spaceId ? s.countSources[spaceId] === "markers" : false));
}

/**
 * Marks a conversation unread from a message. The server may leave its marker where it is, since
 * this never makes anything less unread, so the counts are read again and say what happened. A
 * conversation that is open stays unread until it is left or marked read. A refusal says so in a
 * toast and resolves false.
 */
export async function markAsUnread(input: MarkAsUnreadInput): Promise<boolean> {
  holdIfOpen(input.conversationId);
  try {
    await graphqlClient.request(MARK_AS_UNREAD, { input });
    return true;
  } catch {
    useUnreadStore.getState().clearHeld(input.conversationId);
    toast.error("Could not mark this as unread");
    return false;
  } finally {
    void queryClient.invalidateQueries({ queryKey: queryKeys.unreadCounts(input.workspaceId) });
  }
}

interface MarkableItem {
  id: string;
  authorId: string;
  threadId?: string | null;
  e2eeNotice?: unknown;
  membershipNotice?: unknown;
}

/** The newest top-level message by someone other than `currentUserId`, or null. */
function newestByOthers(items: MarkableItem[], currentUserId: string | undefined): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (isTimelineNotice(item) || item.threadId) continue;
    if (item.authorId !== currentUserId) return item.id;
  }
  return null;
}

/**
 * What the loaded pages say about marking a conversation unread: the message to start from, null
 * when they hold nothing by someone else, or undefined when no page is loaded yet.
 */
export function knownMessageToMarkUnread(
  qc: QueryClient,
  workspaceId: string,
  conversationId: string,
  currentUserId: string | undefined,
): string | null | undefined {
  const cached = qc.getQueryData<InfiniteData<MessagesPage>>(
    queryKeys.messages(workspaceId, conversationId),
  );
  if (!cached) return undefined;
  // Pages are newest first, and each page oldest first.
  for (const page of cached.pages) {
    const found = newestByOthers(page.items, currentUserId);
    if (found) return found;
  }
  return null;
}

/**
 * Marks a conversation unread from the newest message by someone else in its loaded pages, or in
 * its first page when none is loaded. With no such message a toast says there is nothing to mark.
 */
export async function markConversationUnread(
  qc: QueryClient,
  workspaceId: string,
  conversationId: string,
  currentUserId: string | undefined,
): Promise<void> {
  let messageId = knownMessageToMarkUnread(qc, workspaceId, conversationId, currentUserId);
  if (messageId === undefined) {
    try {
      const res = await graphqlClient.request<{ messages: MessagesPage }>(MESSAGES_QUERY, {
        serverId: workspaceId,
        conversationId,
        dir: "AFTER",
        limit: FIRST_PAGE_SIZE,
        includeDeleted: false,
      });
      messageId = newestByOthers(res.messages.items, currentUserId);
    } catch {
      toast.error("Could not mark this as unread");
      return;
    }
  }
  if (!messageId) {
    toast.info("Nothing here to mark unread");
    return;
  }
  await markAsUnread({ workspaceId, conversationId, messageId });
}
