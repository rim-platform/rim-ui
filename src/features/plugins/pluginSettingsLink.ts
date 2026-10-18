import { useShellStore } from "../../shell/state/useShellStore";

const OPEN_PLUGIN_SETTINGS_PREFIX = "workspace.open_plugin_settings.";

/**
 * Open the settings form of the installed plugin `pluginId`: the Settings page
 * on its Plugins tab, with that plugin's settings dialog open. A plugin that is
 * not installed or declares no settings leaves the tab open without a dialog.
 */
export function openPluginSettings(pluginId: string): void {
  useShellStore.getState().setMainSurface({ kind: "settings", tab: "plugins", plugin: pluginId });
}

/**
 * The id of the command that opens the settings form of the plugin `pluginId`.
 *
 * @param pluginId - The plugin's id.
 * @returns `workspace.open_plugin_settings.<pluginId>`.
 */
export function openPluginSettingsCommandId(pluginId: string): string {
  return `${OPEN_PLUGIN_SETTINGS_PREFIX}${pluginId}`;
}

/**
 * The plugin whose settings an open-settings command names.
 *
 * @param commandId - Any command id.
 * @returns The plugin id, or `null` when `commandId` is not an open-settings command.
 */
export function openPluginSettingsTarget(commandId: string): string | null {
  return commandId.startsWith(OPEN_PLUGIN_SETTINGS_PREFIX)
    ? commandId.slice(OPEN_PLUGIN_SETTINGS_PREFIX.length) || null
    : null;
}
