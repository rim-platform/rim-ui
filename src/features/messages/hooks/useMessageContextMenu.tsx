import { useCallback, useState, type ReactNode } from "react";

import type { MessageItem } from "../../../core/types/messages";
import type { DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import { useExecuteCommandMutation } from "../../commands/api/useCommands";
import { useSpaceMarksUnread } from "../../conversations/api/useMarkAsUnread";
import { usePluginContextMenuCommands } from "../../plugins/api/usePluginCommands";
import { dispatchCommand } from "../../commands/runtime/commandDispatcher";
import { currentCommandContext } from "../../commands/runtime/commandContext";
import { showCommandRefusal } from "../../commands/runtime/refusal";
import { runCommandFromClick } from "../../commands/runtime/runFromClick";
import { useDeleteMessage } from "./useDeleteMessage";
import { runPinCommand, runReactionCommand, type MessageTarget } from "../api/messageCommands";
import { copyToClipboard } from "../../../shared/ui/contextMenu/menuActions";
import { useCanModerate } from "../../workspaces/api/useMyServerRole";
import { usePostingRights } from "../../conversations/api/useChannelPosting";
import { ReportMessageDialog } from "../components/ReportMessageDialog";

/** The message a context menu is opened on, as the row knows it. */
export interface MessageMenuTarget {
  messageId: string;
  messageText: string;
  isOwnMessage: boolean;
  isPinned: boolean;
  hasThread: boolean;
  /** The message as this device holds it, for reporting an encrypted one. */
  message?: MessageItem | null;
}

interface UseMessageContextMenuOptions {
  workspaceId: string | null;
  conversationId: string | null;
  /**
   * Forward… is offered with it. The main timeline runs `chat.forward_message`, which opens its
   * forward dialog; the thread panel, whose replies that dialog does not hold, calls it.
   */
  onForward?: (messageId: string, messageText: string) => void;
  /**
   * Reply is offered with it, in the main timeline only, where it runs `chat.start_reply`;
   * absent where the viewer cannot post.
   */
  onReply?: (messageId: string) => void;
  /**
   * Starts editing a message in place in the thread panel, where Edit is offered only with it.
   * The main timeline runs `chat.start_edit`.
   */
  onEdit?: (messageId: string) => void;
  /**
   * The thread the messages are shown in, for the thread panel: its menu has no Reply and no
   * Reply in thread, and the plugins' actions get the thread.
   */
  threadId?: string | null;
}

/** The reactions the menu offers without opening the emoji picker. */
export const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "👀"] as const;

/**
 * The text selected inside the row of message `messageId`, when the selection is not empty
 * and does not reach past that row.
 */
function selectedTextIn(messageId: string): string | null {
  const selection = typeof window === "undefined" ? null : window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const common = selection.getRangeAt(0).commonAncestorContainer;
  const element = common instanceof Element ? common : common.parentElement;
  const row = element?.closest("[data-message-id]");
  if (row?.getAttribute("data-message-id") !== messageId) return null;
  const text = selection.toString();
  return text.trim() ? text : null;
}

/**
 * The message context menu of a conversation, in this order: Add reaction, Copy selection
 * (while text of the message is selected) and Copy text, Reply, Reply in thread, Forward, Pin or
 * Unpin, Mark unread from here (a top-level message of the main timeline, on a host with read
 * markers); then Edit and Delete on the viewer's own message, Report on someone else's; a
 * Moderation section with Delete for an Owner or Moderator; then the plugins' message actions.
 * Add reaction, Reply in thread and Pin or Unpin are left out where the channel's posting policy
 * keeps the viewer from them. Each item runs its command as a context-menu run on the message it
 * was opened on, in that message's thread: the reaction, pin, unpin, mark-unread and delete
 * commands everywhere, and copy, reply, reply in thread, forward and edit in the main timeline,
 * whose message list those commands act through.
 *
 * @returns `getItems`, the menu's items for a message (none without a workspace and a
 *   conversation), `report`, which opens the report dialog for a message as Report message…
 *   does, and `dialog`, the report dialog to render beside the timeline.
 */
export function useMessageContextMenu({
  workspaceId,
  conversationId,
  onForward,
  onReply,
  onEdit,
  threadId = null,
}: UseMessageContextMenuOptions): {
  getItems: (target: MessageMenuTarget) => DropdownMenuItem[];
  report: (target: MessageMenuTarget) => void;
  dialog: ReactNode;
} {
  const executeCommandMutation = useExecuteCommandMutation();
  const pluginContextMenuCommands = usePluginContextMenuCommands("message");
  const deleteMessageFn = useDeleteMessage(workspaceId, conversationId);
  // Anyone can report someone else's message; Owner/Moderator can delete it.
  const [pendingReport, setPendingReport] = useState<MessageMenuTarget | null>(null);
  const canModerate = useCanModerate(workspaceId ?? undefined);
  const rights = usePostingRights(workspaceId, conversationId);
  const marksUnread = useSpaceMarksUnread(workspaceId);

  const getItems = useCallback(
    (target: MessageMenuTarget): DropdownMenuItem[] => {
      if (!workspaceId || !conversationId) return [];
      const { messageId, messageText, isOwnMessage, isPinned, hasThread, message } = target;
      const selectedText = selectedTextIn(messageId);
      const messageThreadId = threadId ?? message?.threadId ?? undefined;
      const menuTarget: MessageTarget = {
        workspaceId,
        conversationId,
        selectedMessageId: messageId,
        ...(messageThreadId && { threadId: messageThreadId }),
      };
      /** Runs `commandId` on this message as a context-menu item. */
      const run = (commandId: string, args?: Record<string, unknown>) =>
        void runCommandFromClick(commandId, args, { source: "menu", target: menuTarget });
      const inTimeline = !threadId;

      const result: DropdownMenuItem[] = [];

      if (rights.reaction) {
        result.push({
          id: "add-reaction",
          label: "Add reaction",
          submenu: QUICK_REACTIONS.map((emoji) => ({
            id: `react-${emoji}`,
            label: emoji,
            onSelect: () => void runReactionCommand(menuTarget, emoji, "menu"),
          })),
        });
      }

      if (selectedText) {
        result.push({
          id: "copy-selection",
          label: "Copy selection",
          onSelect: () => copyToClipboard(selectedText),
        });
      }

      result.push({
        id: "copy-text",
        label: "Copy text",
        onSelect: () => (inTimeline ? run("chat.copy_message_text") : copyToClipboard(messageText)),
      });

      if (onReply && inTimeline) {
        result.push({ id: "reply", label: "Reply", onSelect: () => run("chat.start_reply") });
      }

      if (!hasThread && inTimeline && rights.thread) {
        result.push({
          id: "reply-in-thread",
          label: "Reply in thread",
          // The command opens the thread of the message in its context.
          onSelect: () => run("chat.open_thread"),
        });
      }

      if (onForward) {
        result.push({
          id: "forward-message",
          label: "Forward…",
          onSelect: () =>
            inTimeline ? run("chat.forward_message") : onForward(messageId, messageText),
        });
      }

      if (rights.pin) {
        result.push({
          id: "pin-message",
          label: isPinned ? "Unpin message" : "Pin message",
          onSelect: () => void runPinCommand(menuTarget, !isPinned, { source: "menu" }),
        });
      }

      if (marksUnread && !threadId && !message?.threadId && !message?.isDeleted) {
        result.push({
          id: "mark-unread-from-here",
          label: "Mark unread from here",
          onSelect: () => run("chat.mark_as_unread", { message_id: messageId }),
        });
      }

      if (isOwnMessage) {
        const edit = onEdit
          ? () => onEdit(messageId)
          : inTimeline
            ? () => run("chat.start_edit")
            : undefined;
        if (edit) {
          result.push({
            id: "edit-message",
            label: "Edit message",
            separatorBefore: true,
            onSelect: edit,
          });
        }

        // The confirmation dialog for the delete comes from the server's challenge.
        result.push({
          id: "delete-message",
          label: "Delete message…",
          danger: true,
          separatorBefore: !edit,
          onSelect: () => void deleteMessageFn(messageId, { threadId: messageThreadId }),
        });
      } else {
        result.push({
          id: "report-message",
          label: "Report message…",
          separatorBefore: true,
          onSelect: () => setPendingReport(target),
        });
      }

      if (!isOwnMessage && canModerate) {
        result.push({
          id: "moderator-delete-message",
          label: "Delete message…",
          danger: true,
          separatorBefore: true,
          sectionBefore: "Moderation",
          onSelect: () =>
            void deleteMessageFn(messageId, { asModerator: true, threadId: messageThreadId }),
        });
      }

      pluginContextMenuCommands.forEach((cmd, index) => {
        result.push({
          id: cmd.id,
          label: cmd.title,
          separatorBefore: index === 0,
          onSelect: () => {
            dispatchCommand(cmd, (input) => executeCommandMutation.mutateAsync(input), {
              commandContext: currentCommandContext(menuTarget),
            }).catch((err: unknown) => showCommandRefusal(cmd.title, err));
          },
        });
      });

      return result;
    },
    [
      workspaceId,
      conversationId,
      onForward,
      onReply,
      onEdit,
      threadId,
      canModerate,
      marksUnread,
      rights.reaction,
      rights.thread,
      rights.pin,
      deleteMessageFn,
      pluginContextMenuCommands,
      executeCommandMutation,
    ],
  );

  const dialog =
    pendingReport && workspaceId && conversationId ? (
      <ReportMessageDialog
        workspaceId={workspaceId}
        conversationId={conversationId}
        messageId={pendingReport.messageId}
        threadId={threadId ?? pendingReport.message?.threadId}
        message={pendingReport.message}
        onClose={() => setPendingReport(null)}
      />
    ) : null;

  return { getItems, report: setPendingReport, dialog };
}
