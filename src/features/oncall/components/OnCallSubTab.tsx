import { useMemo, useState } from "react";
import { Plus, Users } from "lucide-react";

import { useCanManageOnCall } from "../../workspaces/api/useMyServerRole";
import { useOnCallSchedules, type OnCallSchedule } from "../api/useOnCallSchedules";
import { useServerOnCall } from "../api/useServerOnCall";
import { useOnCallShifts } from "../api/useOnCallShifts";
import { RotationPreviewStrip } from "./RotationPreviewStrip";
import { ScheduleEditor } from "./ScheduleEditor";
import { OverrideModal } from "./OverrideModal";

const PREVIEW_WINDOW_DAYS = 14;

function ScheduleRow({ schedule, canManage }: { schedule: OnCallSchedule; canManage: boolean }) {
  const now = useMemo(() => new Date(), []);
  const windowStart = now.toISOString();
  const windowEnd = useMemo(
    () => new Date(now.getTime() + PREVIEW_WINDOW_DAYS * 86_400_000).toISOString(),
    [now],
  );
  const { data: shifts } = useOnCallShifts(schedule.id, windowStart, windowEnd);
  const [editing, setEditing] = useState(false);

  return (
    <div className="space-y-2 rounded-lg border border-rim-line bg-rim-panel p-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-rim-text">{schedule.name}</p>
          <p className="text-xs text-rim-text-faint">{schedule.timezone}</p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded px-2 py-1 text-xs text-rim-text-muted transition hover:bg-white/5 hover:text-rim-text"
          >
            Rename
          </button>
        )}
      </div>
      <RotationPreviewStrip shifts={shifts ?? []} windowStart={windowStart} windowEnd={windowEnd} />
      {editing && (
        <ScheduleEditor
          open={editing}
          onClose={() => setEditing(false)}
          serverId={schedule.serverId}
          existing={schedule}
        />
      )}
    </div>
  );
}

interface OnCallSubTabProps {
  serverId: string;
}

/** On-call sub-tab of the Incidents hub: schedule list + rotation preview + overrides. */
export function OnCallSubTab({ serverId }: OnCallSubTabProps) {
  const { data: schedules, isPending } = useOnCallSchedules(serverId);
  const { data: serverOnCall } = useServerOnCall(serverId);
  const canManage = useCanManageOnCall(serverId);
  const [creating, setCreating] = useState(false);
  const [takingShift, setTakingShift] = useState(false);

  const currentByScheduleId = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of serverOnCall ?? []) {
      const name = entry.currentUser?.displayName || entry.currentUser?.username;
      if (name) map.set(entry.scheduleId, name);
    }
    return map;
  }, [serverOnCall]);

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-rim-text">On-call schedules</h2>
        {canManage && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTakingShift(true)}
              disabled={!schedules || schedules.length === 0}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-rim-text-muted transition hover:bg-white/5 hover:text-rim-text disabled:opacity-40"
            >
              <Users className="h-3.5 w-3.5" /> Take shift
            </button>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex items-center gap-1 rounded bg-rim-accent px-2 py-1 text-xs font-medium text-rim-void transition hover:bg-rim-accent/90"
            >
              <Plus className="h-3.5 w-3.5" /> Create schedule
            </button>
          </div>
        )}
      </div>

      {isPending && <p className="text-sm text-rim-text-muted">Loading schedules…</p>}
      {!isPending && (!schedules || schedules.length === 0) && (
        <p className="text-sm text-rim-text-faint">No on-call schedules yet.</p>
      )}

      <div className="space-y-3">
        {(schedules ?? []).map((schedule) => (
          <div key={schedule.id}>
            {currentByScheduleId.has(schedule.id) && (
              <p className="mb-1 text-xs text-rim-text-muted">
                Currently on call:{" "}
                <span className="text-rim-text">{currentByScheduleId.get(schedule.id)}</span>
              </p>
            )}
            <ScheduleRow schedule={schedule} canManage={canManage} />
          </div>
        ))}
      </div>

      {creating && (
        <ScheduleEditor open={creating} onClose={() => setCreating(false)} serverId={serverId} />
      )}
      {takingShift && (
        <OverrideModal
          open={takingShift}
          onClose={() => setTakingShift(false)}
          serverId={serverId}
          initialScheduleId={schedules?.length === 1 ? schedules[0].id : undefined}
        />
      )}
    </div>
  );
}
