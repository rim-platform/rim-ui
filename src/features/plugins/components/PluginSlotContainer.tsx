import { X, Puzzle } from "lucide-react";

import { TrustBadge } from "./TrustBadge";
import { PluginPanel } from "./PluginPanel";
import type { PluginInfo, PluginPanelDef } from "../types";

interface PluginSlotContainerProps {
  plugin: PluginInfo;
  panel: PluginPanelDef;
  onClose: () => void;
}

export function PluginSlotContainer({ plugin, panel, onClose }: PluginSlotContainerProps) {
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-rim-line px-3">
        <div className="flex items-center gap-2">
          <Puzzle className="h-4 w-4 text-rim-accent" />
          <span className="text-sm font-medium text-rim-text">{panel.title}</span>
          <TrustBadge level={plugin.manifest.trust_level} />
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
        <PluginPanel
          pluginId={plugin.manifest.id}
          panelId={panel.id}
          approvedCapabilities={plugin.approved_capabilities}
          onClose={onClose}
        />
      </div>
    </div>
  );
}
