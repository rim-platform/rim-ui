import { useMemo } from "react";
import { X, Puzzle, SlidersHorizontal } from "lucide-react";

import type { DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import { useContextMenu } from "../../../shared/ui/contextMenu/useContextMenu";
import { PluginPanel } from "./PluginPanel";
import { kindLabel, trustBadge } from "./pluginTrust";
import { hasSettings } from "../pluginSettings";
import { openPluginSettings } from "../pluginSettingsLink";
import { WebPluginPanel } from "../web/WebPluginPanel";
import {
  parsePluginCapabilities,
  runtimeKind,
  type PluginInfo,
  type PluginPanelDef,
} from "../types";

interface PluginSlotContainerProps {
  plugin: PluginInfo;
  panel: PluginPanelDef;
  onClose: () => void;
}

/**
 * A plugin's panel in its slot: the host's header (title, plugin, trust; Plugin settings when
 * the plugin has any, and Close) above the plugin's frame. The header's context menu offers
 * the same two actions; the frame keeps its own.
 */
export function PluginSlotContainer({ plugin, panel, onClose }: PluginSlotContainerProps) {
  // A stable list, so the panel keeps its bridge across re-renders.
  const approvedCapabilities = useMemo(
    () => parsePluginCapabilities(plugin.approved_capabilities),
    [plugin.approved_capabilities],
  );
  const web = runtimeKind(plugin) === "WebSandboxed";
  // A new frame for another panel, never the old one navigated.
  const frameKey = `${plugin.plugin_id}/${panel.id}`;
  const settings = hasSettings(plugin.settings_schema);
  const contextMenu = useContextMenu();
  const headerMenuItems = (): DropdownMenuItem[] => [
    ...(settings
      ? [
          {
            id: "plugin-settings",
            label: "Plugin settings",
            onSelect: () => openPluginSettings(plugin.plugin_id),
          },
        ]
      : []),
    { id: "close-panel", label: "Close panel", onSelect: onClose },
  ];
  return (
    <div className="flex h-full flex-col">
      {/* Header: the host's chrome names the plugin and how far to trust it, so a
          plugin cannot pass its panel off as part of the app. */}
      <div
        className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-rim-line px-3"
        {...contextMenu.bind(headerMenuItems, { label: `${panel.title} panel` })}
      >
        <div className="flex min-w-0 items-center gap-2">
          <Puzzle className="h-4 w-4 shrink-0 text-rim-accent" />
          <span className="truncate text-sm font-medium text-rim-text">{panel.title}</span>
          <span className="truncate text-[11px] text-rim-text-muted" title={trustBadge(plugin)}>
            {plugin.display_name} · {kindLabel(plugin)} · {trustBadge(plugin)}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {settings && (
            <button
              type="button"
              onClick={() => openPluginSettings(plugin.plugin_id)}
              title="Plugin settings"
              aria-label={`Settings for ${plugin.display_name || plugin.plugin_id}`}
              className="rounded-lg p-1 text-rim-text-muted transition hover:bg-white/5 hover:text-rim-text"
            >
              <SlidersHorizontal className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            title="Close plugin panel"
            aria-label="Close plugin panel"
            className="rounded-lg p-1 text-rim-text-muted transition hover:bg-white/5 hover:text-rim-text"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      {contextMenu.menu}

      {/* Plugin iframe */}
      <div className="min-h-0 flex-1">
        {web ? (
          <WebPluginPanel
            key={frameKey}
            pluginId={plugin.plugin_id}
            panelId={panel.id}
            pluginName={plugin.display_name}
            approvedCapabilities={approvedCapabilities}
            onClose={onClose}
          />
        ) : (
          <PluginPanel
            key={frameKey}
            pluginId={plugin.plugin_id}
            panelId={panel.id}
            pluginName={plugin.display_name}
            approvedCapabilities={approvedCapabilities}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}
