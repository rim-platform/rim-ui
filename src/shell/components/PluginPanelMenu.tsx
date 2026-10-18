import type { RefObject } from "react";
import { Puzzle, Settings, SlidersHorizontal } from "lucide-react";

import type { RunningPluginPanel } from "../../features/plugins/pluginPanels";
import type { PluginWithSettings } from "../../features/plugins/pluginSettings";
import { openPluginSettings } from "../../features/plugins/pluginSettingsLink";
import { panelSlot } from "../../features/plugins/types";
import { DropdownMenu, type DropdownMenuItem } from "../../shared/ui/DropdownMenu";
import { useShellStore } from "../state/useShellStore";

interface PluginPanelMenuProps {
  panels: RunningPluginPanel[];
  /** The enabled plugins that declare settings, each listed with a Settings row. */
  settings?: PluginWithSettings[];
  /** The plugin panel showing now, marked in the list. */
  shown: { pluginId: string; panelId: string } | null;
  position: { x: number; y: number };
  /** The rail item that toggles the menu. */
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}

/**
 * The panels of the running plugins, one row each with the plugin's name and the panel's
 * title; choosing one opens it in its slot. Without any, it points to the plugin settings.
 * After them, a Settings row for each enabled plugin that declares settings opens its
 * settings form.
 */
export function PluginPanelMenu({
  panels,
  settings = [],
  shown,
  position,
  anchorRef,
  onClose,
}: PluginPanelMenuProps) {
  const openPluginPanel = useShellStore((s) => s.openPluginPanel);
  const setMainSurface = useShellStore((s) => s.setMainSurface);

  const panelItems: DropdownMenuItem[] =
    panels.length > 0
      ? panels.map(({ pluginId, pluginName, panel }) => ({
          id: `${pluginId}/${panel.id}`,
          label: pluginName,
          detail: panel.title,
          icon: <Puzzle className="h-3.5 w-3.5 shrink-0 text-rim-text-muted" />,
          current: shown?.pluginId === pluginId && shown.panelId === panel.id,
          onSelect: () => {
            openPluginPanel(pluginId, panel.id, panelSlot(panel));
            onClose();
          },
        }))
      : [
          {
            id: "manage-plugins",
            label: "Manage plugins",
            icon: <Settings className="h-3.5 w-3.5 shrink-0 text-rim-text-muted" />,
            onSelect: () => {
              setMainSurface({ kind: "settings", tab: "plugins" });
              onClose();
            },
          },
        ];
  const settingsItems: DropdownMenuItem[] = settings.map(({ pluginId, pluginName }) => ({
    id: `settings:${pluginId}`,
    label: pluginName,
    detail: "Settings",
    icon: <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-rim-text-muted" />,
    onSelect: () => {
      openPluginSettings(pluginId);
      onClose();
    },
  }));
  const items = [...panelItems, ...settingsItems];

  return (
    <DropdownMenu
      label="Plugin panels"
      position={position}
      anchorRef={anchorRef}
      onClose={onClose}
      items={items}
      header={
        panels.length === 0 ? (
          <p className="px-3 py-2 text-xs text-rim-text-muted">No running plugin has a panel.</p>
        ) : undefined
      }
    />
  );
}
