import { useState } from "react";
import { Puzzle, Trash2 } from "lucide-react";

import { Button } from "../../../shared/ui/Button";
import { cn } from "../../../shared/ui/cn";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { usePluginList } from "../api/usePluginList";
import { usePluginEnable, usePluginDisable, usePluginUninstall } from "../api/usePluginActions";
import { PluginCapabilityPrompt } from "./PluginCapabilityPrompt";
import type { PluginInfo, PluginHealth } from "../types";

const healthDisplay: Record<PluginHealth, { color: string; label: string }> = {
  running: { color: "bg-rim-success", label: "Running" },
  stopped: { color: "bg-rim-text-muted", label: "Stopped" },
  crashed: { color: "bg-rim-danger", label: "Crashed" },
  timeout: { color: "bg-rim-warm", label: "Timed out" },
};

export function PluginSettingsPage() {
  const { capabilities } = useRuntime();
  const { data: plugins, isLoading } = usePluginList();
  const enable = usePluginEnable();
  const disable = usePluginDisable();
  const uninstall = usePluginUninstall();
  const [permissionsTarget, setPermissionsTarget] = useState<PluginInfo | null>(null);

  if (!capabilities.pluginHost) {
    return (
      <p className="text-sm text-rim-text-muted">
        Plugins are only available in the desktop app.
      </p>
    );
  }

  if (isLoading) {
    return <p className="text-sm text-rim-text-muted">Loading plugins...</p>;
  }

  if (!plugins || plugins.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <Puzzle className="h-8 w-8 text-rim-text-muted" />
        <p className="text-sm text-rim-text-muted">No plugins installed.</p>
      </div>
    );
  }

  function handleToggle(plugin: PluginInfo) {
    if (plugin.enabled) {
      disable.mutate(plugin.plugin_id);
    } else {
      enable.mutate(plugin.plugin_id);
    }
  }

  function handleUninstall(pluginId: string) {
    uninstall.mutate(pluginId);
  }

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium text-rim-text">Installed Plugins</h2>

      <div className="space-y-2">
        {plugins.map((plugin) => {
          const healthState = plugin.health ? healthDisplay[plugin.health] : null;
          return (
          <div
            key={plugin.plugin_id}
            className="flex items-center gap-4 rounded-lg border border-rim-line bg-rim-void p-4"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-rim-accent/10">
              <Puzzle className="h-5 w-5 text-rim-accent" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-rim-text">{plugin.display_name}</span>
              </div>
              <p className="text-xs text-rim-text-muted">{plugin.description}</p>
              <div className="flex items-center gap-3 text-[11px] text-rim-text-muted">
                <span>v{plugin.version}{plugin.author ? ` by ${plugin.author}` : ""}</span>
                {healthState && (
                  <span className="flex items-center gap-1">
                    <span className={cn("h-1.5 w-1.5 rounded-full", healthState.color)} />
                    {healthState.label}
                  </span>
                )}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPermissionsTarget(plugin)}
              >
                Permissions
              </Button>

              <button
                type="button"
                onClick={() => handleToggle(plugin)}
                className="relative inline-flex h-5 w-9 items-center rounded-full transition"
                style={{ backgroundColor: plugin.enabled ? "var(--color-rim-accent)" : "var(--color-rim-line)" }}
                title={plugin.enabled ? "Disable plugin" : "Enable plugin"}
                aria-label={plugin.enabled ? "Disable plugin" : "Enable plugin"}
              >
                <span
                  className="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform"
                  style={{ transform: plugin.enabled ? "translateX(18px)" : "translateX(3px)" }}
                />
              </button>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleUninstall(plugin.plugin_id)}
                title="Uninstall"
                aria-label="Uninstall plugin"
              >
                <Trash2 className="h-4 w-4 text-rim-danger" />
              </Button>
            </div>
          </div>
          );
        })}
      </div>

      {permissionsTarget && (
        <PluginCapabilityPrompt
          open={true}
          onClose={() => setPermissionsTarget(null)}
          plugin={permissionsTarget}
        />
      )}
    </div>
  );
}
