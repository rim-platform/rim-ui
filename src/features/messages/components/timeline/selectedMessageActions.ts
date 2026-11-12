import type { RefObject } from "react";

import { AttachmentStatusEnum } from "../../../../core/graphql/generated/schema-types";
import { useShellStore } from "../../../../shell/state/useShellStore";
import { isTimelineNotice, type TimelineMessage } from "../../../e2ee/utils/timeline";
import type { MessageMenuTarget } from "../../hooks/useMessageContextMenu";
import type {
  MessageSelectionTarget,
  SelectedMessageActions,
} from "../../state/useSelectedMessageStore";

/** What the timeline knows when a command acts on one of its messages. */
export interface SelectedMessageSource {
  itemsById: ReadonlyMap<string, TimelineMessage>;
  currentUserId: string | undefined;
  /** Starts a reply; absent where the person cannot reply. */
  onReply?: (messageId: string) => void;
  /** Opens the report dialog, as the message menu's Report message… does. */
  report: (target: MessageMenuTarget) => void;
  /** Opens the forward dialog for a message. */
  forward: (messageId: string, text: string) => void;
  /** Opens the dialog for deleting a message's failed attachments. */
  deleteAttachment: (messageId: string) => void;
  /** Moves the list's selection; absent until the list's keys are set up. */
  select?: (target: MessageSelectionTarget) => boolean;
  /** Folds or unfolds a message; absent until the list's keys are set up. */
  toggleFold?: (messageId: string) => boolean;
}

/** Whether an attachment is one whose Remove button the message shows. */
export function isDeletableAttachment(attachment: { status: AttachmentStatusEnum }): boolean {
  return attachment.status === AttachmentStatusEnum.FAILED;
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
    forward: (messageId) => {
      const message = actionable(messageId);
      if (!message) return false;
      source.current.forward(messageId, message.text ?? "");
      return true;
    },
    deleteAttachment: (messageId) => {
      const message = actionable(messageId);
      if (!message || !message.attachments.some(isDeletableAttachment)) return false;
      source.current.deleteAttachment(messageId);
      return true;
    },
    select: (target) => source.current.select?.(target) ?? false,
    toggleFold: (messageId) => source.current.toggleFold?.(messageId) ?? false,
  };
}
