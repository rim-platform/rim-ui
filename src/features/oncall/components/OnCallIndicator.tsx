import { useShellStore } from "../../../shell/state/useShellStore";
import { useServerOnCall } from "../api/useServerOnCall";

interface OnCallIndicatorProps {
  serverId: string | null;
}

/**
 * Ambient status-bar signal: "who's carrying the pager", always visible when at least one
 * schedule has a resolved current on-call. Click navigates to the Incidents surface's
 * On-call sub-tab. Not gated behind `DisclosureGate` — on-call is core, not advanced.
 */
export function OnCallIndicator({ serverId }: OnCallIndicatorProps) {
  const setMainSurface = useShellStore((s) => s.setMainSurface);
  const { data: serverOnCall } = useServerOnCall(serverId ?? undefined);

  const active = (serverOnCall ?? []).filter((entry) => entry.currentUser);
  if (active.length === 0) return null;

  const label =
    active.length === 1
      ? `On-call: @${active[0].currentUser?.displayName || active[0].currentUser?.username}`
      : `On-call: ${active.length}`;

  return (
    <button
      type="button"
      onClick={() => setMainSurface({ kind: "incidents", tab: "oncall" })}
      className="rounded bg-rim-panel-soft px-1.5 py-px text-rim-text-muted transition hover:text-rim-text"
      title="View on-call schedules"
    >
      {label}
    </button>
  );
}
