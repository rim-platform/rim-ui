import { useMemo } from "react";
import { X, Puzzle } from "lucide-react";

import { PluginPanel } from "./PluginPanel";
import { kindLabel, trustBadge } from "./pluginTrust";
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

export function PluginSlotContainer({ plugin, panel, onClose }: PluginSlotContainerProps) {
  // A stable list, so the panel keeps its bridge across re-renders.
  const approvedCapabilities = useMemo(
    () => parsePluginCapabilities(plugin.approved_capabilities),
    [plugin.approved_capabilities],
  );
  const web = runtimeKind(plugin) === "WebSandboxed";
  return (
    <div className="flex h-full flex-col">
      {/* Header: the host's chrome names the plugin and how far to trust it, so a
          plugin cannot pass its panel off as part of the app. */}
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-rim-line px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Puzzle className="h-4 w-4 shrink-0 text-rim-accent" />
          <span className="truncate text-sm font-medium text-rim-text">{panel.title}</span>
          <span className="truncate text-[11px] text-rim-text-muted" title={trustBadge(plugin)}>
            {plugin.display_name} · {kindLabel(plugin)} · {trustBadge(plugin)}
          </span>
        </div>
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

      {/* Plugin iframe */}
      <div className="min-h-0 flex-1">
        {web ? (
          <WebPluginPanel
            pluginId={plugin.plugin_id}
            panelId={panel.id}
            pluginName={plugin.display_name}
            approvedCapabilities={approvedCapabilities}
            onClose={onClose}
          />
        ) : (
          <PluginPanel
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
