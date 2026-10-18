import type { RefObject } from "react";
import { Puzzle, Settings } from "lucide-react";

import type { RunningPluginPanel } from "../../features/plugins/pluginPanels";
import { panelSlot } from "../../features/plugins/types";
import { DropdownMenu, type DropdownMenuItem } from "../../shared/ui/DropdownMenu";
import { useShellStore } from "../state/useShellStore";

interface PluginPanelMenuProps {
  panels: RunningPluginPanel[];
  /** The plugin panel showing now, marked in the list. */
  shown: { pluginId: string; panelId: string } | null;
  position: { x: number; y: number };
  /** The rail item that toggles the menu. */
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}

/**
 * The panels of the running plugins, one row each with the plugin's name and the panel's
 * title; choosing one opens it in its slot. Below them, set apart, "Manage plugins…" opens
 * the plugin settings. A plugin's own settings open from its panel's header, its row in
 * Settings → Plugins, or the command palette, never from here.
 */
export function PluginPanelMenu({
  panels,
  shown,
  position,
  anchorRef,
  onClose,
}: PluginPanelMenuProps) {
  const openPluginPanel = useShellStore((s) => s.openPluginPanel);
  const setMainSurface = useShellStore((s) => s.setMainSurface);

  const items: DropdownMenuItem[] = [
    ...panels.map(({ pluginId, pluginName, panel }) => ({
      id: `${pluginId}/${panel.id}`,
      label: pluginName,
      detail: panel.title,
      icon: <Puzzle className="h-3.5 w-3.5 shrink-0 text-rim-text-muted" />,
      current: shown?.pluginId === pluginId && shown.panelId === panel.id,
      onSelect: () => {
        openPluginPanel(pluginId, panel.id, panelSlot(panel));
        onClose();
      },
    })),
    {
      id: "manage-plugins",
      label: "Manage plugins…",
      icon: <Settings className="h-3.5 w-3.5 shrink-0 text-rim-text-muted" />,
      separatorBefore: true,
      onSelect: () => {
        setMainSurface({ kind: "settings", tab: "plugins" });
        onClose();
      },
    },
  ];

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
        ) : (
          <p className="px-3 pb-1 pt-1.5 text-[11px] font-medium text-rim-text-faint">
            Plugin panels
          </p>
        )
      }
    />
  );
}
