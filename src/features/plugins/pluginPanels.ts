import type { PluginInfo, PluginPanelDef } from "./types";

/** A panel of an enabled, running plugin, with the id and name of its plugin. */
export interface RunningPluginPanel {
  pluginId: string;
  pluginName: string;
  panel: PluginPanelDef;
}

/** The panels of the enabled, running plugins, in plugin list order. */
export function runningPluginPanels(
  plugins: readonly PluginInfo[] | undefined,
): RunningPluginPanel[] {
  return (plugins ?? [])
    .filter((plugin) => plugin.enabled && plugin.health === "running")
    .flatMap((plugin) =>
      (plugin.panels ?? []).map((panel) => ({
        pluginId: plugin.plugin_id,
        pluginName: plugin.display_name,
        panel,
      })),
    );
}

const OPEN_PLUGIN_PANEL_PREFIX = "workspace.open_plugin_panel.";

/**
 * The id of the command that opens one plugin panel. A slash ends the plugin id, which never
 * holds one, so no two panels share an id.
 */
export function openPluginPanelCommandId(pluginId: string, panelId: string): string {
  return `${OPEN_PLUGIN_PANEL_PREFIX}${pluginId}/${panelId}`;
}

/** Whether `commandId` names a command that opens a plugin panel. */
export function isOpenPluginPanelCommand(commandId: string): boolean {
  return commandId.startsWith(OPEN_PLUGIN_PANEL_PREFIX);
}

/** The running panel an open-panel command names, or `null` when no running plugin has it. */
export function findOpenPluginPanelTarget(
  plugins: readonly PluginInfo[] | undefined,
  commandId: string,
): RunningPluginPanel | null {
  return (
    runningPluginPanels(plugins).find(
      (entry) => openPluginPanelCommandId(entry.pluginId, entry.panel.id) === commandId,
    ) ?? null
  );
}
