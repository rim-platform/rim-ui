import { commandOfferedHere } from "../../agent/agentAvailability";
import { showInvisibleCharacters } from "../../agents/runtime/invisibleCharacters";
import { useCommands } from "../../commands/api/useCommands";
import { LOCAL_COMMANDS, withClientLabel } from "../../commands/runtime/localCommands";
import {
  argumentsNoSurfaceSupplies,
  NEEDS_ARGUMENTS_NOTE,
} from "../../commands/runtime/commandRunnable";
import type { CommandDefinition } from "../../commands/types";
import { parsePluginCommandId, usePluginCommands } from "../../plugins/api/usePluginCommands";
import { EDIT_HOME_COMMAND, type QuickAction } from "./settings";

/** An action as this device can run it: the command, or why it cannot. */
export type ResolvedAction =
  | { action: QuickAction; command: CommandDefinition; reason: null }
  | { action: QuickAction; command: null; reason: string; title?: string };

/**
 * Resolves each action against the commands the quick box picker offers: the server's that a key
 * can run, this app's own and the installed plugins'. One that is not offered, or whose command
 * needs arguments neither the context nor the action supplies, says why.
 */
export function useResolvedActions(actions: readonly QuickAction[]): ResolvedAction[] {
  const { data: commands, isPending } = useCommands("KEYBIND_PICKER");
  const pluginCommands = usePluginCommands();
  return actions.map((action) => {
    const id = action.commandId;
    if (id === EDIT_HOME_COMMAND) {
      return { action, command: null, reason: "Editing Home can't be a quick action" };
    }
    if (!commandOfferedHere(id)) {
      return { action, command: null, reason: "This command needs the desktop app" };
    }
    const server = commands?.find((cmd) => cmd.id === id);
    const local = LOCAL_COMMANDS.find((cmd) => cmd.id === id && cmd.keybindCapable);
    const plugin = pluginCommands.find((cmd) => cmd.id === id);
    if (server && argumentsNoSurfaceSupplies(server, action.presetArgs).length > 0) {
      return {
        action,
        command: null,
        reason: NEEDS_ARGUMENTS_NOTE,
        title: withClientLabel(server).title,
      };
    }
    const command = server ? withClientLabel(server) : (local ?? plugin);
    if (command) return { action, command, reason: null };
    if (parsePluginCommandId(id)) {
      return { action, command: null, reason: "Its plugin isn't installed on this device" };
    }
    if (isPending) return { action, command: null, reason: "Loading commands…" };
    return { action, command: null, reason: "This command isn't available here" };
  });
}

/** What an action is called: its command's title, or its id while the command is unknown here. */
export function actionTitle(resolved: ResolvedAction): string {
  const title = resolved.command ? resolved.command.title : resolved.title;
  return showInvisibleCharacters(title || resolved.action.commandId);
}
