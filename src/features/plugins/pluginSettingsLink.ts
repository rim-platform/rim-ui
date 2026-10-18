import { useShellStore } from "../../shell/state/useShellStore";

/**
 * Open the settings form of the installed plugin `pluginId`: the Settings page
 * on its Plugins tab, with that plugin's settings dialog open. A plugin that is
 * not installed or declares no settings leaves the tab open without a dialog.
 */
export function openPluginSettings(pluginId: string): void {
  useShellStore.getState().setMainSurface({ kind: "settings", tab: "plugins", plugin: pluginId });
}
