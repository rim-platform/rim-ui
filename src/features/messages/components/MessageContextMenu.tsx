import { useCallback, useMemo, useState } from "react";

import { Dialog } from "../../../shared/ui/Dialog";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import type { DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import { toast } from "../../../shared/toast";
import { useExecuteCommandMutation } from "../../commands/api/useCommands";
import { usePluginContextMenuCommands } from "../../plugins/api/usePluginCommands";
import { usePinMessageMutation, useUnpinMessageMutation } from "../api/usePinMessage";
import { dispatchCommand } from "../../commands/runtime/commandDispatcher";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useDeleteMessage } from "../hooks/useDeleteMessage";
import { useIncidentStore } from "../../incidents/state/useIncidentStore";
import { TagMessageMenu } from "../../incidents/components/TagMessageMenu";

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
  onClose,
  onForward,
}: MessageContextMenuProps) {
  const executeCommandMutation = useExecuteCommandMutation();
  const pluginContextMenuCommands = usePluginContextMenuCommands("message");
  const pinMessage = usePinMessageMutation();
  const unpinMessage = useUnpinMessageMutation();
  const deleteMessageFn = useDeleteMessage(workspaceId, conversationId);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [tagMenuPos, setTagMenuPos] = useState<{ x: number; y: number } | null>(null);
  const activeIncident = useIncidentStore((s) => s.activeIncident);

  const handleDelete = useCallback(async () => {
    setPendingDelete(false);
    onClose();
    await deleteMessageFn(messageId);
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
        onSelect: () => setPendingDelete(true),
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

    // Incident tagging
    if (activeIncident) {
      result.push({
        id: "tag-for-incident",
        label: "Tag for Incident",
        onSelect: () => {
          setTagMenuPos({ x: x + 180, y });
        },
      });
    }

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
    activeIncident,
    x,
    y,
  ]);

  return (
    <>
      {!pendingDelete && <DropdownMenu items={items} position={{ x, y }} onClose={onClose} />}
      {tagMenuPos && (
        <TagMessageMenu
          messageId={messageId}
          position={tagMenuPos}
          onClose={() => {
            setTagMenuPos(null);
            onClose();
          }}
        />
      )}
      <Dialog
        open={pendingDelete}
        onClose={() => {
          setPendingDelete(false);
          onClose();
        }}
        title="Delete Message"
      >
        <p className="text-sm text-rim-text-muted">
          Are you sure you want to delete this message? This cannot be undone.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded px-3 py-1.5 text-sm text-rim-text-muted transition hover:text-rim-text"
            onClick={() => {
              setPendingDelete(false);
              onClose();
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded bg-rim-danger px-3 py-1.5 text-sm text-rim-text transition hover:bg-rim-danger"
            onClick={handleDelete}
          >
            Delete
          </button>
        </div>
      </Dialog>
    </>
  );
}
