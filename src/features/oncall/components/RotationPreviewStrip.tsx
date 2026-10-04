import { useMemo } from "react";

import { Avatar } from "../../../shared/ui/Avatar";
import { cn } from "../../../shared/ui/cn";
import type { OnCallShift } from "../api/useOnCallShifts";

interface RotationPreviewStripProps {
  /** Server-resolved shift list for the window — see the hard-rule note below. */
  shifts: OnCallShift[];
  /** ISO start of the preview window (inclusive). */
  windowStart: string;
  /** ISO end of the preview window (exclusive). */
  windowEnd: string;
}

interface LaidOutSegment {
  shift: OnCallShift;
  /** Percentage (0-100) from the left edge of the strip. */
  leftPct: number;
  /** Percentage (0-100) width of the segment. */
  widthPct: number;
}

/**
 * Lays out a fixed, already-resolved shift list across `[windowStart, windowEnd)` as
 * percentages. This is pure interval arithmetic (clamp + normalize), NOT rotation
 * resolution — it never looks at a rotation spec, participant order, timezone, or handoff
 * rule. See the component doc comment for why that distinction matters.
 */
function layoutSegments(
  shifts: OnCallShift[],
  windowStart: string,
  windowEnd: string,
): LaidOutSegment[] {
  const startMs = new Date(windowStart).getTime();
  const endMs = new Date(windowEnd).getTime();
  const span = endMs - startMs;
  if (!(span > 0)) return [];

  return shifts
    .map((shift) => {
      const shiftStart = Math.max(new Date(shift.startAt).getTime(), startMs);
      const shiftEnd = Math.min(new Date(shift.endAt).getTime(), endMs);
      if (shiftEnd <= shiftStart) return null;
      return {
        shift,
        leftPct: ((shiftStart - startMs) / span) * 100,
        widthPct: ((shiftEnd - shiftStart) / span) * 100,
      };
    })
    .filter((s): s is LaidOutSegment => s !== null);
}

function formatRange(startAt: string, endAt: string): string {
  const fmt = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${fmt.format(new Date(startAt))} – ${fmt.format(new Date(endAt))}`;
}

/**
 * Read-only horizontal band showing "who is on call when" for a resolved window.
 *
 * **HARD RULE (Track C1 §2, enforced by test): this component renders ONLY the
 * server-resolved intervals it's handed via `shifts` (from {@link useOnCallShifts}).**
 * It never derives shifts from a rotation spec, participant order, timezone, or handoff
 * rule — rotation math with overrides/DST/handoff boundaries is subtle and must match the
 * escalation engine's own resolution exactly, or the UI would show a different on-call than
 * who actually gets paged. See `docs/oncall-ui.md`.
 *
 * `isOverride` segments (server-flagged, not client-derived) render in `rim-warm` instead
 * of the base-rotation `rim-accent`, so an override is visually obvious at a glance.
 */
export function RotationPreviewStrip({
  shifts,
  windowStart,
  windowEnd,
}: RotationPreviewStripProps) {
  const segments = useMemo(
    () => layoutSegments(shifts, windowStart, windowEnd),
    [shifts, windowStart, windowEnd],
  );

  if (segments.length === 0) {
    return <p className="text-xs text-rim-text-faint">No on-call coverage in this window.</p>;
  }

  return (
    <div
      role="list"
      aria-label="On-call rotation preview"
      className="relative flex h-10 w-full overflow-hidden rounded-md border border-rim-line bg-rim-void"
    >
      {segments.map(({ shift, leftPct, widthPct }, i) => {
        const name = shift.user?.displayName || shift.user?.username || "Unassigned";
        return (
          <div
            key={`${shift.startAt}-${i}`}
            role="listitem"
            tabIndex={0}
            title={`${name}: ${formatRange(shift.startAt, shift.endAt)}`}
            style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
            className={cn(
              "absolute inset-y-0 flex items-center gap-1.5 overflow-hidden border-r border-rim-void px-1.5",
              "outline-none focus-visible:ring-1 focus-visible:ring-rim-accent",
              shift.isOverride ? "bg-rim-warm/20" : "bg-rim-accent/20",
            )}
          >
            <Avatar
              url={shift.user?.avatarUrl}
              name={name}
              userId={shift.user?.id ?? "unassigned"}
              size="xs"
            />
            <span className="truncate text-[11px] text-rim-text">{name}</span>
          </div>
        );
      })}
    </div>
  );
}
