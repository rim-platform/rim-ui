import { useMemo } from "react";

import { usePluginList } from "./usePluginList";
import type { CommandDefinition } from "../../commands/types";
import type { PluginCommandDef, PluginContextType, PluginInfo } from "../types";

function pluginCommandId(pluginId: string, commandId: string): string {
  return `plugin.${pluginId}.${commandId}`;
}

// Extended command definition that carries context_types metadata
export interface PluginCommandDefinition extends CommandDefinition {
  contextTypes: PluginContextType[];
}

function pluginCommandToDefinition(plugin: PluginInfo, cmd: PluginCommandDef): PluginCommandDefinition {
  return {
    id: pluginCommandId(plugin.manifest.id, cmd.id),
    title: cmd.title,
    description: cmd.description,
    category: plugin.manifest.name,
    sourceKind: "PLUGIN",
    executionTarget: "DESKTOP_LOCAL",
    requiredContext: [],
    requiredCapabilities: [],
    visibleInPalette: true,
    visibleInContextMenus: cmd.context_menu_action ?? false,
    keybindCapable: true,
    dangerous: false,
    contextTypes: cmd.context_types ?? [],
  };
}

export function usePluginCommands() {
  const { data: plugins } = usePluginList();

  return useMemo<PluginCommandDefinition[]>(() => {
    if (!plugins) return [];

    const commands: PluginCommandDefinition[] = [];
    for (const plugin of plugins) {
      if (!plugin.enabled || plugin.health !== "running") continue;
      for (const cmd of plugin.manifest.commands ?? []) {
        commands.push(pluginCommandToDefinition(plugin, cmd));
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
