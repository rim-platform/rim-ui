import { useMemo } from "react";

import { usePluginList } from "./usePluginList";
import type { CommandDefinition } from "../../commands/types";
import type { PluginContextType } from "../types";

function pluginCommandId(pluginId: string, commandId: string): string {
  return `plugin.${pluginId}.${commandId}`;
}

// Extended command definition that carries context_types metadata
export interface PluginCommandDefinition extends CommandDefinition {
  contextTypes: PluginContextType[];
}

export function usePluginCommands() {
  const { data: plugins } = usePluginList();

  return useMemo<PluginCommandDefinition[]>(() => {
    if (!plugins) return [];

    const commands: PluginCommandDefinition[] = [];
    for (const plugin of plugins) {
      if (!plugin.enabled || plugin.health !== "running") continue;
      // context_actions from the Rust flat shape — qualified IDs already applied.
      for (const action of plugin.context_actions ?? []) {
        commands.push({
          id: pluginCommandId(plugin.plugin_id, action.command_id),
          title: action.title,
          description: action.title,
          category: plugin.display_name,
          sourceKind: "PLUGIN",
          executionTarget: "DESKTOP_LOCAL",
          requiredContext: [],
          requiredCapabilities: [],
          visibleInPalette: true,
          visibleInContextMenus: true,
          keybindCapable: true,
          dangerous: false,
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

export function parsePluginCommandId(commandId: string): { pluginId: string; command: string } | null {
  const match = commandId.match(/^plugin\.([^.]+)\.(.+)$/);
  if (!match) return null;
  return { pluginId: match[1], command: match[2] };
}
