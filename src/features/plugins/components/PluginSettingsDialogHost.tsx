import { usePluginList } from "../api/usePluginList";
import { hasSettings } from "../pluginSettings";
import { usePluginSettingsDialogStore } from "../state/usePluginSettingsDialogStore";
import { PluginSettingsDialog } from "./PluginSettingsDialog";

/**
 * Shows the settings form of the plugin {@link usePluginSettingsDialogStore} names, over the
 * current view. Nothing shows for a plugin that is not installed or declares no settings.
 */
export function PluginSettingsDialogHost() {
  const pluginId = usePluginSettingsDialogStore((s) => s.pluginId);
  const close = usePluginSettingsDialogStore((s) => s.close);
  const { data: plugins } = usePluginList();
  const plugin = pluginId
    ? plugins?.find((p) => p.plugin_id === pluginId && hasSettings(p.settings_schema))
    : undefined;
  if (!plugin) return null;
  return <PluginSettingsDialog key={plugin.plugin_id} plugin={plugin} onClose={close} />;
}
