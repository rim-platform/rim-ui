import type { RefObject } from "react";

import { useShellStore } from "../../../../shell/state/useShellStore";
import { isTimelineNotice, type TimelineMessage } from "../../../e2ee/utils/timeline";
import type { MessageMenuTarget } from "../../hooks/useMessageContextMenu";
import type { SelectedMessageActions } from "../../state/useSelectedMessageStore";

/** What the timeline knows when a command acts on one of its messages. */
export interface SelectedMessageSource {
  itemsById: ReadonlyMap<string, TimelineMessage>;
  currentUserId: string | undefined;
  /** Starts a reply; absent where the person cannot reply. */
  onReply?: (messageId: string) => void;
  /** Opens the report dialog, as the message menu's Report message… does. */
  report: (target: MessageMenuTarget) => void;
}

/**
 * The actions the commands on the selected message run in a conversation's timeline, read
 * through `source` when they run so a new message does not replace them.
 *
 * @param conversationId - The conversation the timeline shows.
 * @param source - The timeline's messages, viewer and handlers, kept current by the timeline.
 * @returns The actions, as the message menu and the list's keys do them.
 */
export function selectedMessageActions(
  conversationId: string,
  source: RefObject<SelectedMessageSource>,
): SelectedMessageActions {
  /** The message `messageId` names, when it is one a person can act on. */
  const actionable = (messageId: string) => {
    const message = source.current.itemsById.get(messageId);
    return message && !message.isDeleted && !isTimelineNotice(message) ? message : null;
  };
  const isOwn = (authorId: string) =>
    source.current.currentUserId !== undefined && authorId === source.current.currentUserId;
  return {
    conversationId,
    textOf: (messageId) => {
      const message = source.current.itemsById.get(messageId);
      return message ? (message.text ?? "") : null;
    },
    reply: (messageId) => {
      const { onReply } = source.current;
      if (!onReply || !actionable(messageId)) return false;
      onReply(messageId);
      return true;
    },
    edit: (messageId) => {
      const message = actionable(messageId);
      if (!message || !isOwn(message.authorId)) return false;
      useShellStore.getState().setEditingMessageId(messageId);
      return true;
    },
    report: (messageId) => {
      const message = actionable(messageId);
      if (!message || isOwn(message.authorId)) return false;
      source.current.report({
        messageId,
        messageText: message.text ?? "",
        isOwnMessage: false,
        isPinned: message.isPinned === true,
        hasThread: Boolean(message.threadId || message.rootThreadId),
        message,
      });
      return true;
    },
  };
}
