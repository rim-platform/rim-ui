import { cn } from "../../shared/ui/cn";
import { useConnectionStore } from "../../features/system/state/useConnectionStore";
import { useUnreadStore } from "../../features/conversations/state/useUnreadStore";
import { useShellStore } from "../state/useShellStore";
import { useLayoutPresetStore } from "../state/useLayoutPresetStore";
import { BUILT_IN_PRESETS } from "../types/layoutPreset";
import { DisclosureGate } from "../../features/disclosure/components/DisclosureGate";
import { SkillTier } from "../../core/graphql/generated/schema-types";
import { surfaceToContext } from "../../features/commands/runtime/keybindEngine";

function connectionLabel(status: string): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Reconnecting";
    case "disconnected":
      return "Offline";
    default:
      return "Unknown";
  }
}

function connectionDotColor(status: string): string {
  switch (status) {
    case "connected":
      return "bg-rim-success";
    case "connecting":
      return "bg-rim-warm";
    case "disconnected":
      return "bg-rim-danger";
    default:
      return "bg-rim-text-faint";
  }
}

export function StatusBar() {
  const connectionStatus = useConnectionStore((s) => s.status);
  const counts = useUnreadStore((s) => s.counts);
  const focusedSurface = useShellStore((s) => s.focusedSurface);
  const isThreadOpen = useShellStore((s) => s.isThreadOpen);
  const navigationMode = useShellStore((s) => s.navigationMode);

  const activePresetId = useLayoutPresetStore((s) => s.activePresetId);
  const customPresets = useLayoutPresetStore((s) => s.customPresets);

  const totalUnread = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const contextLabel = surfaceToContext(focusedSurface);

  const activePresetName = activePresetId
    ? ([...BUILT_IN_PRESETS, ...customPresets].find((p) => p.id === activePresetId)?.name ?? null)
    : null;

  return (
    <div className="flex h-6 shrink-0 items-center border-t border-rim-line bg-rim-void px-3 text-[10px] text-rim-text-faint select-none">
      {/* Left: connection status */}
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "inline-block h-1.5 w-1.5 rounded-full",
            connectionDotColor(connectionStatus),
          )}
        />
        <span>{connectionLabel(connectionStatus)}</span>
      </div>

      {/* Center: unread + thread indicator */}
      <div className="flex flex-1 items-center justify-center gap-3">
        {totalUnread > 0 && (
          <span className="rounded-full bg-rim-accent/20 px-1.5 py-px text-[10px] font-medium text-rim-accent">
            {totalUnread} unread
          </span>
        )}
        {isThreadOpen && (
          <span className="text-rim-text-faint">Thread open</span>
        )}
      </div>

      {/* Right: mode + keybind context + layout preset */}
      <div className="flex items-center gap-2">
        <DisclosureGate minTier={SkillTier.INTERMEDIATE}>
          {activePresetName && (
            <span className="rounded bg-rim-warm/20 px-1.5 py-px font-medium text-rim-warm">
              {activePresetName}
            </span>
          )}
        </DisclosureGate>
        {navigationMode ? (
          <span className="rounded bg-rim-accent/20 px-1.5 py-px font-medium text-rim-accent">
            NAVIGATE
          </span>
        ) : (
          <span className="rounded bg-rim-panel-soft px-1.5 py-px text-rim-text-muted">
            COMPOSE
          </span>
        )}
        <span className="text-rim-text-faint">{contextLabel}</span>
      </div>
    </div>
  );
}
