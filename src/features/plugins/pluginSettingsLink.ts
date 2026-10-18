import { usePluginSettingsDialogStore } from "./state/usePluginSettingsDialogStore";

const OPEN_PLUGIN_SETTINGS_PREFIX = "workspace.open_plugin_settings.";

/**
 * Open the settings form of the installed plugin `pluginId` over whatever is open, so the
 * user stays in the plugin's panel or wherever they were. A plugin that is not installed or
 * declares no settings opens nothing.
 */
export function openPluginSettings(pluginId: string): void {
  usePluginSettingsDialogStore.getState().open(pluginId);
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
