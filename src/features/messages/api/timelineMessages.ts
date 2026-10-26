import type { InfiniteData, QueryClient } from "@tanstack/react-query";

import type { MessageEventData } from "../../../core/events/types";
import { queryKeys } from "../../../core/query/keys";
import type { MessageItem, MessagesPage } from "../../../core/types/messages";

/** A message as `sendMessage` returns it (`MessageFields`): everything but the reactions. */
export type SentMessage = Omit<MessageItem, "reactions" | "e2ee">;

/** A timeline item from a `NewMessage` or `MessageUpdated` event's message. */
export function messageFromEvent(msg: MessageEventData): MessageItem {
  return {
    id: msg.id,
    serverId: msg.server_id,
    conversationId: msg.conversation_id,
    threadId: msg.thread_id ?? null,
    rootThreadId: msg.root_thread_id ?? null,
    authorId: msg.author_id,
    author: null,
    text: msg.text ?? "",
    hasAttachments: msg.has_attachments ?? false,
    parentMessageId: msg.parent_message_id ?? null,
    isPinned: false,
    mentionedUserIds: [],
    forwardedFromMessageId: msg.forwarded_from_message_id ?? null,
    forwardedFrom: null,
    isDeleted: msg.is_deleted,
    sentAt: msg.sent_at,
    reactions: [],
    attachments: [],
    linkPreviews: [],
  };
}

/** A timeline item from the message `sendMessage` returned. */
export function messageFromSend(msg: SentMessage): MessageItem {
  return { ...msg, reactions: [] };
}

/**
 * Put a new message of `workspaceId` into its conversation's timeline: appended to the newest
 * page, unless the timeline already holds it or is not loaded. A thread reply refetches its
 * thread and the thread's summary instead.
 */
export function insertTimelineMessage(qc: QueryClient, workspaceId: string, message: MessageItem) {
  const { conversationId, threadId } = message;
  if (threadId) {
    void qc.invalidateQueries({
      queryKey: queryKeys.threadMessages(workspaceId, conversationId, threadId),
    });
    // Reply count and last reply time.
    void qc.invalidateQueries({ queryKey: ["threadByRoot", workspaceId, conversationId] });
    void qc.invalidateQueries({ queryKey: ["threadReplyCount", workspaceId, conversationId] });
    return;
  }
  const item = { ...message, serverId: workspaceId };
  qc.setQueryData<InfiniteData<MessagesPage>>(
    queryKeys.messages(workspaceId, conversationId),
    (old) => {
      const newest = old?.pages[0];
      if (!old || !newest) return old;
      if (old.pages.some((p) => p.items.some((m) => m.id === item.id))) return old;
      // Items are oldest-first: the new message goes last.
      return {
        ...old,
        pages: [{ ...newest, items: [...newest.items, item] }, ...old.pages.slice(1)],
      };
    },
  );
}
