import { useEffect, useMemo, useState } from "react";

import { Button } from "../../../shared/ui/Button";
import { Dialog } from "../../../shared/ui/Dialog";
import { toast } from "../../../shared/toast";
import { useCurrentUser } from "../../workspaces/api/useCurrentUser";
import { useServerMembers } from "../../workspaces/api/useServerMembers";
import { useOnCallSchedules, useCreateOnCallOverride } from "../api/useOnCallSchedules";
import { useWhoIsOnCall } from "../api/useWhoIsOnCall";

interface OverrideModalProps {
  open: boolean;
  onClose: () => void;
  serverId: string;
  /** Preselects a schedule (e.g. invoked from a specific schedule row). If omitted, the
   * user picks one first — needed for the status-bar/`oncall.take_shift` entry points,
   * which may not have a schedule in context when there's more than one. */
  initialScheduleId?: string;
}

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * "Take shift" / "Cover for…" quick action (Track C1 §3). **Owner/Moderator only** —
 * `createOnCallOverride` is schedule CRUD on the backend, so a Guest cannot self-assign in
 * C1 (a deliberate scope choice per the C1c handoff, not an oversight — a future
 * member-allowed "volunteer" mutation would need a separate backend endpoint).
 *
 * Defaults: **who** = me; **when** = now → the schedule's current `shiftEndsAt` (one
 * Enter). Both are overridable before confirming.
 */
export function OverrideModal({ open, onClose, serverId, initialScheduleId }: OverrideModalProps) {
  const { data: me } = useCurrentUser();
  const { data: members } = useServerMembers(serverId);
  const { data: schedules } = useOnCallSchedules(serverId);
  const [scheduleId, setScheduleId] = useState(initialScheduleId ?? "");
  const [userId, setUserId] = useState(me?.id ?? "");
  const [customRange, setCustomRange] = useState(false);
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");

  const { data: whoIsOnCall } = useWhoIsOnCall(scheduleId || undefined);
  const createOverride = useCreateOnCallOverride();

  const defaultEnd = useMemo(
    () =>
      toDatetimeLocal(whoIsOnCall?.shiftEndsAt ?? new Date(Date.now() + 3600_000).toISOString()),
    [whoIsOnCall?.shiftEndsAt],
  );

  useEffect(() => {
    if (open) {
      setScheduleId(initialScheduleId ?? "");
      setUserId(me?.id ?? "");
      setCustomRange(false);
      setStartAt("");
      setEndAt("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialScheduleId]);

  const handleConfirm = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!scheduleId || !userId) return;
    const effectiveStart =
      customRange && startAt ? new Date(startAt).toISOString() : new Date().toISOString();
    const effectiveEnd =
      customRange && endAt ? new Date(endAt).toISOString() : new Date(defaultEnd).toISOString();

    createOverride.mutate(
      { scheduleId, userId, startAt: effectiveStart, endAt: effectiveEnd },
      {
        onSuccess: () => {
          toast.success("Shift override created");
          onClose();
        },
        onError: () => toast.error("Failed to create override"),
      },
    );
  };

  return (
    <Dialog open={open} onClose={onClose} title="Take shift">
      <form className="space-y-4" onSubmit={handleConfirm}>
        {!initialScheduleId && (
          <div>
            <label className="mb-1 block text-[11px] text-rim-text-muted">Schedule</label>
            <select
              value={scheduleId}
              onChange={(e) => setScheduleId(e.target.value)}
              className="w-full rounded border border-rim-line bg-rim-void px-2 py-1.5 text-sm text-rim-text outline-none focus:border-rim-accent"
            >
              <option value="">Select schedule…</option>
              {(schedules ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="mb-1 block text-[11px] text-rim-text-muted">Who</label>
          <select
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="w-full rounded border border-rim-line bg-rim-void px-2 py-1.5 text-sm text-rim-text outline-none focus:border-rim-accent"
          >
            {me && <option value={me.id}>{me.displayName || me.username} (me)</option>}
            {(members ?? [])
              .filter((m) => m.userId !== me?.id)
              .map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.displayName || m.username}
                </option>
              ))}
          </select>
        </div>

        <div>
          <label className="mb-1 flex items-center gap-2 text-[11px] text-rim-text-muted">
            <input
              type="checkbox"
              checked={customRange}
              onChange={(e) => setCustomRange(e.target.checked)}
            />
            Custom time range
          </label>
          {customRange ? (
            <div className="grid grid-cols-2 gap-2">
              <input
                type="datetime-local"
                aria-label="Start"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
                className="w-full rounded border border-rim-line bg-rim-void px-2 py-1.5 text-sm text-rim-text outline-none focus:border-rim-accent"
              />
              <input
                type="datetime-local"
                aria-label="End"
                value={endAt}
                onChange={(e) => setEndAt(e.target.value)}
                className="w-full rounded border border-rim-line bg-rim-void px-2 py-1.5 text-sm text-rim-text outline-none focus:border-rim-accent"
              />
            </div>
          ) : (
            <p className="text-xs text-rim-text-faint">
              Now → end of current shift ({new Date(defaultEnd).toLocaleString()})
            </p>
          )}
        </div>

        {createOverride.isError && (
          <p className="rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger">
            Failed to create override.
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={!scheduleId || !userId || createOverride.isPending}
            isLoading={createOverride.isPending}
          >
            Take shift
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
