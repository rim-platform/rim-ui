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
}

/**
 * The message context menu of a conversation: Copy Text, Forward, Open Thread, Edit and Delete
 * on the viewer's own message, Report on someone else's (and Delete for an Owner or
 * Moderator), Pin or Unpin, then the plugins' message actions.
 *
 * @returns `getItems`, the menu's items for a message (none without a workspace and a
 *   conversation), and `dialog`, the report dialog to render beside the timeline.
 */
export function useMessageContextMenu({
  workspaceId,
  conversationId,
  onForward,
}: UseMessageContextMenuOptions): {
  getItems: (target: MessageMenuTarget) => DropdownMenuItem[];
  dialog: ReactNode;
} {
  const executeCommandMutation = useExecuteCommandMutation();
  const pluginContextMenuCommands = usePluginContextMenuCommands("message");
  const pinMessage = usePinMessageMutation();
  const unpinMessage = useUnpinMessageMutation();
  const deleteMessageFn = useDeleteMessage(workspaceId, conversationId);
  // Anyone can report someone else's message; Owner/Moderator can delete it.
  const [pendingReport, setPendingReport] = useState<MessageMenuTarget | null>(null);
  const canModerate = useCanModerate(workspaceId ?? undefined);

  const getItems = useCallback(
    (target: MessageMenuTarget): DropdownMenuItem[] => {
      if (!workspaceId || !conversationId) return [];
      const { messageId, messageText, isOwnMessage, isPinned, hasThread, message } = target;

      const result: DropdownMenuItem[] = [
        {
          id: "copy-text",
          label: "Copy Text",
          onSelect: () => {
            navigator.clipboard.writeText(messageText);
            toast.success("Copied to clipboard");
          },
        },
        {
          id: "forward-message",
          label: "Forward",
          onSelect: () => onForward?.(messageId, messageText),
        },
      ];

      if (!hasThread) {
        result.push({
          id: "open-thread",
          label: "Open Thread",
          onSelect: () => useShellStore.getState().openThreadForMessage(messageId),
        });
      }

      if (isOwnMessage) {
        result.push({
          id: "edit-message",
          label: "Edit Message",
          onSelect: () => useShellStore.getState().setEditingMessageId(messageId),
        });

        // The confirmation dialog for the delete comes from the server's challenge.
        result.push({
          id: "delete-message",
          label: "Delete Message",
          danger: true,
          onSelect: () => void deleteMessageFn(messageId),
        });
      }

      if (!isOwnMessage) {
        result.push({
          id: "report-message",
          label: "Report Message",
          onSelect: () => setPendingReport(target),
        });
      }

      if (!isOwnMessage && canModerate) {
        result.push({
          id: "moderator-delete-message",
          label: "Delete Message",
          danger: true,
          onSelect: () =>
            void deleteMessageFn(messageId, { asModerator: true }).then((deleted) => {
              if (deleted) toast.success("Message deleted");
            }),
        });
      }

      result.push({
        id: "pin-message",
        label: isPinned ? "Unpin Message" : "Pin Message",
        onSelect: () => {
          const vars = { serverId: workspaceId, conversationId, messageId };
          if (isPinned) {
            unpinMessage.mutate(vars);
          } else {
            pinMessage.mutate(vars);
          }
        },
      });

      for (const cmd of pluginContextMenuCommands) {
        result.push({
          id: cmd.id,
          label: cmd.title,
          onSelect: () => {
            dispatchCommand(cmd, (input) => executeCommandMutation.mutateAsync(input), {
              commandContext: currentCommandContext({
                workspaceId,
                conversationId,
                selectedMessageId: messageId,
                threadId: message?.threadId ?? undefined,
              }),
            });
          },
        });
      }

      return result;
    },
    [
      workspaceId,
      conversationId,
      onForward,
      canModerate,
      deleteMessageFn,
      pinMessage,
      unpinMessage,
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
