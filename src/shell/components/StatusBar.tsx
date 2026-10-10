import { cn } from "../../shared/ui/cn";
import { useConnectionStore } from "../../features/system/state/useConnectionStore";
import { useShellStore } from "../state/useShellStore";
import { useLayoutPresetStore } from "../state/useLayoutPresetStore";
import { BUILT_IN_PRESETS } from "../types/layoutPreset";
import { DisclosureGate } from "../../features/disclosure/components/DisclosureGate";
import { SkillTier, WorkspaceFeature } from "../../core/graphql/generated/schema-types";
import { surfaceToContext } from "../../features/commands/runtime/keybindEngine";
import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";
import { OnCallIndicator } from "../../features/oncall/components/OnCallIndicator";
import { useFeatureEnabled } from "../../features/workspaces/hooks/useFeatureEnabled";
import { useKeybindProfileStore } from "../../features/commands/state/useKeybindProfileStore";
import { useVimStore } from "../../features/commands/state/useVimStore";

/** Map internal keybind context strings to user-friendly labels. */
function humanizeContext(ctx: string | null): string | null {
  switch (ctx) {
    case "MESSAGE_LIST":
      return "Messages";
    case "COMPOSER":
      return "Composer";
    case "THREAD_VIEW":
      return "Thread";
    case "COMMAND_PALETTE":
      return "Palette";
    case "PANEL":
      return "Panel";
    case "CONVERSATION_VIEW":
      return "Conversation";
    case "GLOBAL":
    case null:
      return null;
    default:
      return null;
  }
}

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
  const mainSurface = useShellStore((s) => s.mainSurface);
  const focusedSurface = useShellStore((s) => s.focusedSurface);
  const navigationMode = useShellStore((s) => s.navigationMode);
  const displayDensity = useShellStore((s) => s.displayDensity);
  const vimMode = useKeybindProfileStore((s) => s.profile.vimMode);
  const vim = useVimStore((s) => s.mode);
  const vimPending = useVimStore((s) => s.pending);

  const activePresetId = useLayoutPresetStore((s) => s.activePresetId);
  const customPresets = useLayoutPresetStore((s) => s.customPresets);
  const incidentsEnabled = useFeatureEnabled(WorkspaceFeature.INCIDENTS);
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);

  const rawContext = surfaceToContext(focusedSurface);
  const contextLabel = humanizeContext(rawContext);

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

      {/* Center spacer */}
      <div className="flex-1" />

      {/* Right: density + mode + keybind context + layout preset + on-call */}
      <div className="flex items-center gap-2">
        {incidentsEnabled && <OnCallIndicator serverId={workspaceId} />}
        {displayDensity !== "comfortable" && (
          <span className="rounded bg-rim-panel-soft px-1.5 py-px text-rim-text-faint">
            {displayDensity === "compact" ? "Compact" : "Ultra Compact"}
          </span>
        )}
        <DisclosureGate minTier={SkillTier.INTERMEDIATE}>
          {activePresetName && (
            <span className="rounded bg-rim-warm/20 px-1.5 py-px font-medium text-rim-warm">
              {activePresetName}
            </span>
          )}
        </DisclosureGate>
        {vimMode && (
          <span
            role="status"
            aria-label={`Vim ${vim} mode`}
            className={cn(
              "rounded px-1.5 py-px font-medium",
              vim === "normal"
                ? "bg-rim-accent/20 text-rim-accent"
                : "bg-rim-panel-soft text-rim-text-muted",
            )}
          >
            {vim === "normal" ? "NORMAL" : "INSERT"}
            {vimPending && <span className="ml-1 font-mono">{vimPending}</span>}
          </span>
        )}
        {!vimMode &&
          mainSurface.kind === "conversation" &&
          (navigationMode ? (
            <span className="rounded bg-rim-accent/20 px-1.5 py-px font-medium text-rim-accent">
              NAVIGATE
            </span>
          ) : (
            <span className="rounded bg-rim-panel-soft px-1.5 py-px text-rim-text-muted">
              COMPOSE
            </span>
          ))}
        {contextLabel && <span className="text-rim-text-faint">{contextLabel}</span>}
      </div>
    </div>
  );
}
