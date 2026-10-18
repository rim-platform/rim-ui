import { useCallback, useState, type ReactNode } from "react";

import type { MessageItem } from "../../../core/types/messages";
import type { DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import { toast } from "../../../shared/toast";
import { useExecuteCommandMutation } from "../../commands/api/useCommands";
import { usePluginContextMenuCommands } from "../../plugins/api/usePluginCommands";
import { usePinMessageMutation, useUnpinMessageMutation } from "../api/usePinMessage";
import { dispatchCommand } from "../../commands/runtime/commandDispatcher";
import { currentCommandContext } from "../../commands/runtime/commandContext";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useDeleteMessage } from "./useDeleteMessage";
import { useToggleReactionMutation } from "../api/useToggleReaction";
import { copyToClipboard } from "../../../shared/ui/contextMenu/menuActions";
import { useCanModerate } from "../../workspaces/api/useMyServerRole";
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
  onForward?: (messageId: string, messageText: string) => void;
  /**
   * The thread the messages are shown in, for the thread panel: its menu has no Reply in
   * thread and no Edit message (the panel edits nothing in place), and the plugins' actions
   * get the thread.
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
 * (while text of the message is selected) and Copy text, Reply in thread, Forward, Pin or
 * Unpin; then Edit and Delete on the viewer's own message, Report on someone else's; a
 * Moderation section with Delete for an Owner or Moderator; then the plugins' message actions.
 *
 * @returns `getItems`, the menu's items for a message (none without a workspace and a
 *   conversation), and `dialog`, the report dialog to render beside the timeline.
 */
export function useMessageContextMenu({
  workspaceId,
  conversationId,
  onForward,
  threadId = null,
}: UseMessageContextMenuOptions): {
  getItems: (target: MessageMenuTarget) => DropdownMenuItem[];
  dialog: ReactNode;
} {
  const executeCommandMutation = useExecuteCommandMutation();
  const pluginContextMenuCommands = usePluginContextMenuCommands("message");
  const pinMessage = usePinMessageMutation();
  const unpinMessage = useUnpinMessageMutation();
  const toggleReaction = useToggleReactionMutation();
  const deleteMessageFn = useDeleteMessage(workspaceId, conversationId);
  // Anyone can report someone else's message; Owner/Moderator can delete it.
  const [pendingReport, setPendingReport] = useState<MessageMenuTarget | null>(null);
  const canModerate = useCanModerate(workspaceId ?? undefined);

  const getItems = useCallback(
    (target: MessageMenuTarget): DropdownMenuItem[] => {
      if (!workspaceId || !conversationId) return [];
      const { messageId, messageText, isOwnMessage, isPinned, hasThread, message } = target;
      const selectedText = selectedTextIn(messageId);

      const result: DropdownMenuItem[] = [
        {
          id: "add-reaction",
          label: "Add reaction",
          submenu: QUICK_REACTIONS.map((emoji) => ({
            id: `react-${emoji}`,
            label: emoji,
            onSelect: () =>
              toggleReaction.mutate({ serverId: workspaceId, conversationId, messageId, emoji }),
          })),
        },
      ];

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
        onSelect: () => copyToClipboard(messageText),
      });

      if (!hasThread && !threadId) {
        result.push({
          id: "reply-in-thread",
          label: "Reply in thread",
          onSelect: () => useShellStore.getState().openThreadForMessage(messageId),
        });
      }

      if (onForward) {
        result.push({
          id: "forward-message",
          label: "Forward…",
          onSelect: () => onForward(messageId, messageText),
        });
      }

      result.push({
        id: "pin-message",
        label: isPinned ? "Unpin message" : "Pin message",
        onSelect: () => {
          const vars = { serverId: workspaceId, conversationId, messageId };
          if (isPinned) {
            unpinMessage.mutate(vars);
          } else {
            pinMessage.mutate(vars);
          }
        },
      });

      if (isOwnMessage) {
        if (!threadId) {
          result.push({
            id: "edit-message",
            label: "Edit message",
            separatorBefore: true,
            onSelect: () => useShellStore.getState().setEditingMessageId(messageId),
          });
        }

        // The confirmation dialog for the delete comes from the server's challenge.
        result.push({
          id: "delete-message",
          label: "Delete message…",
          danger: true,
          separatorBefore: Boolean(threadId),
          onSelect: () => void deleteMessageFn(messageId),
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
            void deleteMessageFn(messageId, { asModerator: true }).then((deleted) => {
              if (deleted) toast.success("Message deleted");
            }),
        });
      }

      pluginContextMenuCommands.forEach((cmd, index) => {
        result.push({
          id: cmd.id,
          label: cmd.title,
          separatorBefore: index === 0,
          onSelect: () => {
            dispatchCommand(cmd, (input) => executeCommandMutation.mutateAsync(input), {
              commandContext: currentCommandContext({
                workspaceId,
                conversationId,
                selectedMessageId: messageId,
                threadId: threadId ?? message?.threadId ?? undefined,
              }),
            });
          },
        });
      });

      return result;
    },
    [
      workspaceId,
      conversationId,
      onForward,
      threadId,
      canModerate,
      deleteMessageFn,
      pinMessage,
      unpinMessage,
      toggleReaction,
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
        message={pendingReport.message}
        onClose={() => setPendingReport(null)}
      />
    ) : null;

  return { getItems, dialog };
}
