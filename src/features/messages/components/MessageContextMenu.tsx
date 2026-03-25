import { useCallback, useMemo } from "react";
import { Terminal, Plug, User, Zap } from "lucide-react";

import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import type { DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import { useCommands, useExecuteCommandMutation } from "../../commands/api/useCommands";
import { dispatchCommand } from "../../commands/runtime/commandDispatcher";
import { useShellStore } from "../../../shell/state/useShellStore";
import type { CommandDefinition, CommandSourceKind } from "../../commands/types";

function sourceIcon(source: CommandSourceKind) {
  switch (source) {
    case "BuiltIn":
      return <Terminal className="h-3.5 w-3.5 text-rim-text-muted" />;
    case "Plugin":
      return <Plug className="h-3.5 w-3.5 text-rim-accent" />;
    case "User":
      return <User className="h-3.5 w-3.5 text-rim-text-muted" />;
    case "Integration":
      return <Zap className="h-3.5 w-3.5 text-rim-text-muted" />;
  }
}

interface MessageContextMenuProps {
  x: number;
  y: number;
  messageId: string;
  messageText: string;
  conversationId: string;
  workspaceId: string;
  onClose: () => void;
}

export function MessageContextMenu({
  x,
  y,
  messageId,
  messageText,
  conversationId,
  workspaceId,
  onClose,
}: MessageContextMenuProps) {
  const { data: commands } = useCommands("ContextMenu");
  const executeCommandMutation = useExecuteCommandMutation();

  const contextMenuCommands = useMemo(
    () => (commands ?? []).filter((cmd) => cmd.visibleInContextMenus),
    [commands],
  );

  const handleCommandClick = useCallback(
    async (command: CommandDefinition) => {
      // Handle local commands with context directly
      if (command.executionTarget === "DesktopLocal") {
        if (command.id === "chat.copy_message_text") {
          await navigator.clipboard.writeText(messageText);
          onClose();
          return;
        }
        if (command.id === "chat.open_thread") {
          useShellStore.getState().openThreadForMessage(messageId);
          onClose();
          return;
        }
      }

      // Dispatch via generic dispatcher (backend or other local commands)
      onClose();
      await dispatchCommand(
        command,
        (input) => executeCommandMutation.mutateAsync(input),
        {
          commandContext: {
            workspaceId,
            conversationId,
            selectedMessageId: messageId,
          },
          confirmedDangerous: command.dangerous ? true : undefined,
        },
      );
    },
    [messageId, messageText, conversationId, workspaceId, executeCommandMutation, onClose],
  );

  const items: DropdownMenuItem[] = useMemo(
    () =>
      contextMenuCommands.map((cmd) => ({
        id: cmd.id,
        label: cmd.title,
        icon: sourceIcon(cmd.sourceKind),
        danger: cmd.dangerous,
        onSelect: () => handleCommandClick(cmd),
      })),
    [contextMenuCommands, handleCommandClick],
  );

  return (
    <DropdownMenu
      items={items}
      position={{ x, y }}
      onClose={onClose}
    />
  );
}
