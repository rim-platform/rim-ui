import { findPluginCommand } from "../../plugins/runtime/pluginCommandInfo";
import { isOpenPluginPanelCommand } from "../../plugins/pluginPanels";
import { openPluginSettingsTarget } from "../../plugins/pluginSettingsLink";
import type { CommandDefinition } from "../types";
import {
  BUILT_IN_COMMAND_TITLES,
  inLocalCommandNamespace,
  LOCAL_COMMANDS,
  withClientLabel,
} from "./localCommands";

/** What a keybind's command is called before or without its definition. */
export function keybindCommandTitle(commandId: string): string {
  return findPluginCommand(commandId)?.title ?? BUILT_IN_COMMAND_TITLES[commandId] ?? commandId;
}

/** Whether `commandId` names a plugin's command, panel or settings, which the dispatcher finds itself. */
function isPluginShaped(commandId: string): boolean {
  return (
    commandId.startsWith("plugin.") ||
    isOpenPluginPanelCommand(commandId) ||
    openPluginSettingsTarget(commandId) !== null
  );
}

/**
 * The command a keybind runs: the server's keybind-capable one, else its palette one, else this
 * app's own, else a stand-in for a plugin's command or for any command while the server's lists
 * are loading, whose target the id's namespace tells. `null` when the lists have loaded and
 * nothing has the id.
 */
export function keybindCommand(
  commandId: string,
  keybindCommands: readonly CommandDefinition[] | undefined,
  paletteCommands: readonly CommandDefinition[] | undefined,
): CommandDefinition | null {
  const found =
    keybindCommands?.find((cmd) => cmd.id === commandId) ??
    paletteCommands?.find((cmd) => cmd.id === commandId) ??
    LOCAL_COMMANDS.find((cmd) => cmd.id === commandId);
  if (found) return withClientLabel(found);
  const plugin = isPluginShaped(commandId);
  if (!plugin && keybindCommands && paletteCommands) return null;
  const pluginCommand = findPluginCommand(commandId);
  return {
    id: commandId,
    title: keybindCommandTitle(commandId),
    description: "",
    category: "",
    sourceKind: commandId.startsWith("plugin.") ? "PLUGIN" : "BUILT_IN",
    executionTarget: inLocalCommandNamespace(commandId) ? "DESKTOP_LOCAL" : "BACKEND",
    requiredContext: [],
    requiredCapabilities: [],
    visibleInPalette: false,
    visibleInContextMenus: false,
    keybindCapable: true,
    dangerous: pluginCommand?.dangerous ?? false,
  };
}
