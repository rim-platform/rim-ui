import { Puzzle } from "lucide-react";

import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { usePluginList } from "../api/usePluginList";
import { usePluginEnable, usePluginDisable } from "../api/usePluginActions";
import { TrustBadge } from "./TrustBadge";
import { PluginErrorBoundary } from "./PluginErrorBoundary";
import { useShellStore } from "../../../shell/state/useShellStore";
import { cn } from "../../../shared/ui/cn";
import type { PluginHealth } from "../types";

const healthIndicator: Record<PluginHealth, { color: string; label: string }> = {
  running: { color: "bg-green-400", label: "Running" },
  stopped: { color: "bg-rim-text-muted", label: "Stopped" },
  crashed: { color: "bg-rim-danger", label: "Crashed" },
  timeout: { color: "bg-rim-warm", label: "Timed out" },
};

export function PluginToolPanel() {
  const { capabilities } = useRuntime();
  const { data: plugins, isLoading } = usePluginList();
  const setMainSurface = useShellStore((s) => s.setMainSurface);
  const enable = usePluginEnable();
  const disable = usePluginDisable();

  if (!capabilities.pluginHost) {
    return (
      <p className="px-2 py-4 text-sm text-rim-text-muted">
        Plugins are only available in the desktop app.
      </p>
    );
  }

  if (isLoading) {
    return <p className="px-2 py-4 text-sm text-rim-text-muted">Loading...</p>;
  }

  const enabledPlugins = plugins?.filter((p) => p.enabled) ?? [];

  if (enabledPlugins.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-2 py-8 text-center">
        <Puzzle className="h-6 w-6 text-rim-text-muted" />
        <p className="text-xs text-rim-text-muted">No active plugins.</p>
        <button
          type="button"
          onClick={() => setMainSurface({ kind: "settings" })}
          className="text-xs text-rim-accent hover:underline"
        >
          Manage plugins
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {enabledPlugins.map((plugin) => {
        const indicator = healthIndicator[plugin.health];

        return (
          <div key={plugin.manifest.id} className="px-1">
            <PluginErrorBoundary
              pluginId={plugin.manifest.id}
              pluginName={plugin.manifest.name}
              health={plugin.health}
              onRestart={() => {
                disable.mutate(plugin.manifest.id, {
                  onSuccess: () => enable.mutate(plugin.manifest.id),
                });
              }}
              onDisable={() => disable.mutate(plugin.manifest.id)}
            >
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-white/5"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rim-accent/10">
                  <Puzzle className="h-4 w-4 text-rim-accent" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm text-rim-text">{plugin.manifest.name}</span>
                    <TrustBadge level={plugin.manifest.trust_level} />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={cn("h-1.5 w-1.5 rounded-full", indicator.color)} />
                    <p className="truncate text-[11px] text-rim-text-muted">{indicator.label}</p>
                  </div>
                </div>
              </button>
            </PluginErrorBoundary>
          </div>
        );
      })}
    </div>
  );
}
