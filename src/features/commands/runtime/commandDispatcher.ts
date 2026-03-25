import type { CommandDefinition, CommandResult } from "../types";
import { logger } from "../../../core/logger";
import { useCommandStore } from "../state/useCommandStore";
import { useShellStore } from "../../../shell/state/useShellStore";

type ExecuteBackendCommand = (input: {
  commandId: string;
  args?: Record<string, unknown>;
  commandContext?: Record<string, unknown>;
  confirmedDangerous?: boolean;
}) => Promise<{ executeCommand: CommandResult }>;

// Registry of desktop-local command handlers
const localHandlers: Record<string, () => void> = {
  "workspace.open_command_palette": () => {
    useCommandStore.getState().toggleCommandPalette();
  },
  "workspace.open_settings": () => {
    useShellStore.getState().setMainSurface({ kind: "settings" });
  },
  "workspace.cycle_recent_activity": () => {
    // TODO: implement recent activity cycling in shell store
    logger.debug("[RIM] cycle_recent_activity: not yet implemented");
  },
  "chat.copy_message_text": () => {
    // Handled at context menu level — this is a no-op fallback
    logger.debug("[RIM] copy_message_text: handled at context menu level");
  },
  "chat.open_thread": () => {
    // Handled at context menu level — this is a no-op fallback
    logger.debug("[RIM] open_thread: handled at context menu level");
  },
};

export async function dispatchCommand(
  command: CommandDefinition,
  executeBackend: ExecuteBackendCommand,
  context?: {
    args?: Record<string, unknown>;
    commandContext?: Record<string, unknown>;
    confirmedDangerous?: boolean;
  }
): Promise<CommandResult | null> {
  if (command.executionTarget === "DesktopLocal") {
    const handler = localHandlers[command.id];
    if (handler) {
      handler();
      return { status: "Success", message: "Executed locally", payload: null, followUpCommands: [] };
    }
    logger.warn(`[RIM] No local handler for command: ${command.id}`);
    return { status: "Error", message: `No local handler for ${command.id}`, payload: null, followUpCommands: [] };
  }

  // Backend command
  const result = await executeBackend({
    commandId: command.id,
    args: context?.args,
    commandContext: context?.commandContext,
    confirmedDangerous: context?.confirmedDangerous,
  });

  return result.executeCommand;
}
