import { Puzzle } from "lucide-react";

import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { usePluginList } from "../api/usePluginList";
import { usePluginEnable, usePluginDisable } from "../api/usePluginActions";
import { PluginErrorBoundary } from "./PluginErrorBoundary";
import { useShellStore } from "../../../shell/state/useShellStore";
import { cn } from "../../../shared/ui/cn";
import { panelSlot, type PluginHealth } from "../types";

const healthIndicator: Record<PluginHealth, { color: string; label: string }> = {
  running: { color: "bg-rim-success", label: "Running" },
  stopped: { color: "bg-rim-text-muted", label: "Stopped" },
  crashed: { color: "bg-rim-danger", label: "Crashed" },
  timeout: { color: "bg-rim-warm", label: "Timed out" },
};

/**
 * The enabled plugins with their health, and under each running one a row per panel that
 * opens it.
 */
export function PluginToolPanel() {
  const { capabilities } = useRuntime();
  const { data: plugins, isLoading } = usePluginList();
  const setMainSurface = useShellStore((s) => s.setMainSurface);
  const openPluginPanel = useShellStore((s) => s.openPluginPanel);
  const activePluginPanel = useShellStore((s) => s.activePluginPanel);
  const enable = usePluginEnable();
  const disable = usePluginDisable();

  if (!capabilities.pluginHost && !capabilities.webPlugins) {
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
          onClick={() => setMainSurface({ kind: "settings", tab: "plugins" })}
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
        const health = plugin.health ?? "stopped";
        const indicator = healthIndicator[health];
        const panels = health === "running" ? (plugin.panels ?? []) : [];

        const row = (
          <>
            <div className="flex w-full items-center gap-3 px-2 py-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rim-accent/10">
                <Puzzle className="h-4 w-4 text-rim-accent" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm text-rim-text">{plugin.display_name}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={cn("h-1.5 w-1.5 rounded-full", indicator.color)} />
                  <p className="truncate text-[11px] text-rim-text-muted">{indicator.label}</p>
                </div>
              </div>
            </div>
            {panels.map((panel) => {
              const open =
                activePluginPanel?.pluginId === plugin.plugin_id &&
                activePluginPanel.panelId === panel.id;
              return (
                <button
                  key={panel.id}
                  type="button"
                  onClick={() => openPluginPanel(plugin.plugin_id, panel.id, panelSlot(panel))}
                  aria-label={`${plugin.display_name}: ${panel.title}`}
                  aria-current={open ? "true" : undefined}
                  className={cn(
                    "flex w-full items-center rounded-lg py-1.5 pl-13 pr-2 text-left text-sm transition",
                    open
                      ? "bg-rim-accent/15 text-rim-accent"
                      : "text-rim-text-muted hover:bg-white/5 hover:text-rim-text",
                  )}
                >
                  <span className="truncate">{panel.title}</span>
                </button>
              );
            })}
          </>
        );

        return (
          <div key={plugin.plugin_id} className="px-1">
            {/* A crashed or timed-out plugin shows its failure with restart and disable. */}
            {health === "crashed" || health === "timeout" ? (
              <PluginErrorBoundary
                pluginId={plugin.plugin_id}
                pluginName={plugin.display_name}
                health={health}
                onRestart={() => {
                  disable.mutate(plugin.plugin_id, {
                    onSuccess: () => enable.mutate(plugin.plugin_id),
                  });
                }}
                onDisable={() => disable.mutate(plugin.plugin_id)}
              >
                {row}
              </PluginErrorBoundary>
            ) : (
              row
            )}
          </div>
        );
      })}
    </div>
  );
}
