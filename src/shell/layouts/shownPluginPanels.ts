import { useMemo } from "react";

import { usePluginList } from "../../features/plugins/api/usePluginList";
import { canShowPanels } from "../../features/plugins/pluginPanels";
import { panelSlot, type PluginInfo, type PluginPanelDef } from "../../features/plugins/types";
import { useShellStore } from "../state/useShellStore";

/** An open plugin panel with the plugin it belongs to. */
export type ShownPluginPanel = { plugin: PluginInfo; panel: PluginPanelDef };

/**
 * The open plugin panel, split by where it shows. Each is `null` unless the panel's plugin is
 * listed, may show panels and declares the panel.
 *
 * @returns The panel in the tool panel slot and the one in the main area; at most one is set.
 */
export function useShownPluginPanels(): {
  toolPanel: ShownPluginPanel | null;
  mainArea: ShownPluginPanel | null;
} {
  const activePluginPanel = useShellStore((s) => s.activePluginPanel);
  const { data: plugins } = usePluginList();
  return useMemo(() => {
    const none = { toolPanel: null, mainArea: null };
    if (!activePluginPanel || !plugins) return none;
    const plugin = plugins.find(
      (p) => p.plugin_id === activePluginPanel.pluginId && canShowPanels(p),
    );
    const panel = plugin?.panels?.find((p) => p.id === activePluginPanel.panelId);
    if (!plugin || !panel) return none;
    const shown = { plugin, panel };
    return panelSlot(panel) === "main_area"
      ? { toolPanel: null, mainArea: shown }
      : { toolPanel: shown, mainArea: null };
  }, [activePluginPanel, plugins]);
}
