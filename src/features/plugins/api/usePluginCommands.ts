import { useMemo } from "react";

import { usePluginList } from "./usePluginList";
import type { CommandDefinition } from "../../commands/types";
import type { PluginContextType } from "../types";

// Extended command definition that carries context_types metadata
export interface PluginCommandDefinition extends CommandDefinition {
  contextTypes: PluginContextType[];
}

/**
 * Every command of the enabled plugins: their manifest commands (for the
 * palette, the keybind picker and keybinds) and their context actions (for
 * context menus). A stopped plugin's commands stay listed; running one says
 * the plugin is not running.
 */
export function usePluginCommands() {
  const { data: plugins } = usePluginList();

  return useMemo<PluginCommandDefinition[]>(() => {
    if (!plugins) return [];

    const commands: PluginCommandDefinition[] = [];
    for (const plugin of plugins) {
      if (!plugin.enabled) continue;
      for (const command of plugin.commands ?? []) {
        // The palette runs a command without arguments, so one that needs them
        // is run from its plugin's panel instead.
        const needsArguments = command.arguments.some((argument) => argument.required);
        commands.push({
          id: command.qualified_id,
          title: command.title,
          description: command.description,
          category: plugin.display_name,
          sourceKind: "PLUGIN",
          executionTarget: "DESKTOP_LOCAL",
          requiredContext: [],
          requiredCapabilities: [],
          visibleInPalette: !needsArguments,
          visibleInContextMenus: false,
          keybindCapable: command.keybind_capable && !needsArguments,
          dangerous: command.dangerous,
          contextTypes: [],
        });
      }
      // context_actions from the Rust flat shape — `command_id` is already
      // qualified as `plugin.<plugin_id>.<command>`. The palette lists the
      // command itself, so an action only shows in context menus.
      for (const action of plugin.context_actions ?? []) {
        const command = plugin.commands?.find((c) => c.qualified_id === action.command_id);
        commands.push({
          id: action.command_id,
          title: action.title,
          description: command?.description ?? action.title,
          category: plugin.display_name,
          sourceKind: "PLUGIN",
          executionTarget: "DESKTOP_LOCAL",
          requiredContext: [],
          requiredCapabilities: [],
          visibleInPalette: false,
          visibleInContextMenus: true,
          keybindCapable: false,
          dangerous: command?.dangerous ?? false,
          contextTypes: action.context_types as PluginContextType[],
        });
      }
    }
    return commands;
  }, [plugins]);
}

export function usePluginContextMenuCommands(contextType?: PluginContextType) {
  const commands = usePluginCommands();
  return useMemo(
    () =>
      commands.filter((cmd) => {
        if (!cmd.visibleInContextMenus) return false;
        // If context_types specified, filter by it; otherwise show everywhere
        if (contextType && cmd.contextTypes.length > 0) {
          return cmd.contextTypes.includes(contextType);
        }
        return true;
      }),
    [commands, contextType],
  );
}

export function parsePluginCommandId(
  commandId: string,
): { pluginId: string; command: string } | null {
  const match = commandId.match(/^plugin\.([^.]+)\.(.+)$/);
  if (!match) return null;
  return { pluginId: match[1], command: match[2] };
}
