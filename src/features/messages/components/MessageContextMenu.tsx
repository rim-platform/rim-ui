import { useCallback, useMemo, useState } from "react";

import type { MessageItem } from "../../../core/types/messages";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import type { DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import { toast } from "../../../shared/toast";
import { useExecuteCommandMutation } from "../../commands/api/useCommands";
import { usePluginContextMenuCommands } from "../../plugins/api/usePluginCommands";
import { usePinMessageMutation, useUnpinMessageMutation } from "../api/usePinMessage";
import { dispatchCommand } from "../../commands/runtime/commandDispatcher";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useDeleteMessage } from "../hooks/useDeleteMessage";
import { useCanModerate } from "../../workspaces/api/useMyServerRole";
import { ReportMessageDialog } from "./ReportMessageDialog";

interface MessageContextMenuProps {
  x: number;
  y: number;
  messageId: string;
  messageText: string;
  conversationId: string;
  workspaceId: string;
  isOwnMessage: boolean;
  isPinned: boolean;
  hasThread: boolean;
  /** The message as this device holds it, for reporting an encrypted one. */
  message?: MessageItem | null;
  onClose: () => void;
  onForward?: (messageId: string, messageText: string) => void;
}

export function MessageContextMenu({
  x,
  y,
  messageId,
  messageText,
  conversationId,
  workspaceId,
  isOwnMessage,
  isPinned,
  hasThread,
  message,
  onClose,
  onForward,
}: MessageContextMenuProps) {
  const executeCommandMutation = useExecuteCommandMutation();
  const pluginContextMenuCommands = usePluginContextMenuCommands("message");
  const pinMessage = usePinMessageMutation();
  const unpinMessage = useUnpinMessageMutation();
  const deleteMessageFn = useDeleteMessage(workspaceId, conversationId);
  // Anyone can report someone else's message; Owner/Moderator can delete it.
  const [pendingReport, setPendingReport] = useState(false);
  const canModerate = useCanModerate(workspaceId);

  // The confirmation dialog for the delete comes from the server's challenge.
  const handleDelete = useCallback(() => {
    onClose();
    void deleteMessageFn(messageId);
  }, [messageId, deleteMessageFn, onClose]);

  const handleModeratorDelete = useCallback(async () => {
    onClose();
    const deleted = await deleteMessageFn(messageId, { asModerator: true });
    if (deleted) toast.success("Message deleted");
  }, [messageId, deleteMessageFn, onClose]);

  const items: DropdownMenuItem[] = useMemo(() => {
    const result: DropdownMenuItem[] = [
      {
        id: "copy-text",
        label: "Copy Text",
        onSelect: () => {
          navigator.clipboard.writeText(messageText);
          toast.success("Copied to clipboard");
          onClose();
        },
      },
    ];

    result.push({
      id: "forward-message",
      label: "Forward",
      onSelect: () => {
        onClose();
        onForward?.(messageId, messageText);
      },
    });

    if (!hasThread) {
      result.push({
        id: "open-thread",
        label: "Open Thread",
        onSelect: () => {
          useShellStore.getState().openThreadForMessage(messageId);
          onClose();
        },
      });
    }

    if (isOwnMessage) {
      result.push({
        id: "edit-message",
        label: "Edit Message",
        onSelect: () => {
          useShellStore.getState().setEditingMessageId(messageId);
          onClose();
        },
      });

      result.push({
        id: "delete-message",
        label: "Delete Message",
        danger: true,
        onSelect: handleDelete,
      });
    }

    if (!isOwnMessage) {
      result.push({
        id: "report-message",
        label: "Report Message",
        onSelect: () => setPendingReport(true),
      });
    }

    if (!isOwnMessage && canModerate) {
      result.push({
        id: "moderator-delete-message",
        label: "Delete Message",
        danger: true,
        onSelect: () => void handleModeratorDelete(),
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
        onClose();
      },
    });

    // Plugin context menu actions
    for (const cmd of pluginContextMenuCommands) {
      result.push({
        id: cmd.id,
        label: cmd.title,
        onSelect: () => {
          onClose();
          dispatchCommand(cmd, (input) => executeCommandMutation.mutateAsync(input), {
            commandContext: { workspaceId, conversationId, selectedMessageId: messageId },
          });
        },
      });
    }

    return result;
  }, [
    messageId,
    messageText,
    isOwnMessage,
    isPinned,
    hasThread,
    onClose,
    pluginContextMenuCommands,
    executeCommandMutation,
    pinMessage,
    unpinMessage,
    workspaceId,
    conversationId,
    canModerate,
    handleDelete,
    handleModeratorDelete,
  ]);

  return (
    <>
      {!pendingReport && <DropdownMenu items={items} position={{ x, y }} onClose={onClose} />}
      {pendingReport && (
        <ReportMessageDialog
          workspaceId={workspaceId}
          conversationId={conversationId}
          messageId={messageId}
          message={message}
          onClose={() => {
            setPendingReport(false);
            onClose();
          }}
        />
      )}
    </>
  );
}
