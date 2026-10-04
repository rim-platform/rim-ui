import { useCallback } from "react";
import { ChevronUp, ChevronDown, X } from "lucide-react";

import { useServerMembers } from "../../workspaces/api/useServerMembers";
import { useOnCallSchedules } from "../api/useOnCallSchedules";
import {
  EscalationActionKindGql,
  EscalationTargetKindGql,
} from "../../../core/graphql/generated/schema-types";

/** Draft (not-yet-submitted) shape of one escalation step, edited locally before
 * `createEscalationPolicy`/`updateEscalationPolicy` replaces the full step list atomically. */
export interface DraftEscalationStep {
  delaySeconds: number;
  targetKind: EscalationTargetKindGql;
  targetUserId: string;
  targetScheduleId: string;
  actions: EscalationActionKindGql[];
}

export function makeEmptyDraftStep(): DraftEscalationStep {
  return {
    delaySeconds: 0,
    targetKind: EscalationTargetKindGql.ON_CALL,
    targetUserId: "",
    targetScheduleId: "",
    actions: [EscalationActionKindGql.MENTION_IN_CHANNEL],
  };
}

function formatDelay(seconds: number): string {
  if (seconds === 0) return "immediately";
  if (seconds < 60) return `after ${seconds}s`;
  if (seconds % 3600 === 0) return `after ${seconds / 3600}h`;
  if (seconds % 60 === 0) return `after ${seconds / 60}m`;
  return `after ${seconds}s`;
}

interface EscalationStepListProps {
  serverId: string;
  steps: DraftEscalationStep[];
  onChange: (steps: DraftEscalationStep[]) => void;
}

/**
 * Ordered escalation-step editor with a read-only vertical-stepper preview above it (e.g.
 * "L1 immediately → @on-call", "L2 after 5m → @alice"). Delay semantics are
 * delay-after-previous-step (resolved in the C1 contract — step 0's delay is "from
 * declare"). Targets are user-or-schedule ONLY — there is no channel target; a channel is
 * reached via the `MENTION_IN_CHANNEL` action instead. Reorder is keyboard-first: `j`/`k`
 * move the focused step down/up, mirroring `RotationLayerEditor`'s participant reorder.
 */
export function EscalationStepList({ serverId, steps, onChange }: EscalationStepListProps) {
  const { data: members } = useServerMembers(serverId);
  const { data: schedules } = useOnCallSchedules(serverId);

  const targetLabel = useCallback(
    (step: DraftEscalationStep) => {
      if (step.targetKind === EscalationTargetKindGql.USER) {
        const m = members?.find((mm) => mm.userId === step.targetUserId);
        return m ? `@${m.displayName || m.username}` : "(pick a user)";
      }
      const s = schedules?.find((ss) => ss.id === step.targetScheduleId);
      return s ? `@on-call (${s.name})` : "(pick a schedule)";
    },
    [members, schedules],
  );

  const updateStep = useCallback(
    (index: number, patch: Partial<DraftEscalationStep>) => {
      onChange(steps.map((s, i) => (i === index ? { ...s, ...patch } : s)));
    },
    [steps, onChange],
  );

  const moveStep = useCallback(
    (index: number, direction: "up" | "down") => {
      const target = direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= steps.length) return;
      const next = [...steps];
      [next[index], next[target]] = [next[target], next[index]];
      onChange(next);
    },
    [steps, onChange],
  );

  const removeStep = useCallback(
    (index: number) => onChange(steps.filter((_, i) => i !== index)),
    [steps, onChange],
  );

  const toggleAction = useCallback(
    (index: number, action: EscalationActionKindGql) => {
      const step = steps[index];
      const has = step.actions.includes(action);
      updateStep(index, {
        actions: has ? step.actions.filter((a) => a !== action) : [...step.actions, action],
      });
    },
    [steps, updateStep],
  );

  const handleRowKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent) => {
      if (e.key === "j") {
        e.preventDefault();
        moveStep(index, "down");
      } else if (e.key === "k") {
        e.preventDefault();
        moveStep(index, "up");
      }
    },
    [moveStep],
  );

  return (
    <div className="space-y-3">
      {/* Read-only stepper preview */}
      <div className="space-y-1 rounded-lg border border-rim-line bg-rim-void p-3">
        {steps.map((step, i) => (
          <div key={i} className="text-xs text-rim-text-muted">
            <span className="font-mono text-rim-text">L{i + 1}</span>{" "}
            {formatDelay(step.delaySeconds)}
            {" → "}
            <span className="text-rim-text">{targetLabel(step)}</span>
          </div>
        ))}
        {steps.length === 0 && (
          <p className="text-xs text-rim-text-faint">No steps yet — add one below.</p>
        )}
      </div>

      {/* Editable step list */}
      <ul role="list" className="space-y-2">
        {steps.map((step, index) => (
          <li
            key={index}
            role="listitem"
            tabIndex={0}
            onKeyDown={(e) => handleRowKeyDown(index, e)}
            className="space-y-2 rounded-lg border border-rim-line bg-rim-panel p-3 outline-none focus-visible:ring-1 focus-visible:ring-rim-accent"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-rim-text">Step {index + 1}</span>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => moveStep(index, "up")}
                  disabled={index === 0}
                  aria-label={`Move step ${index + 1} up`}
                  className="rounded p-0.5 text-rim-text-muted transition hover:text-rim-text disabled:opacity-30"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => moveStep(index, "down")}
                  disabled={index === steps.length - 1}
                  aria-label={`Move step ${index + 1} down`}
                  className="rounded p-0.5 text-rim-text-muted transition hover:text-rim-text disabled:opacity-30"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => removeStep(index)}
                  aria-label={`Remove step ${index + 1}`}
                  className="rounded p-0.5 text-rim-text-muted transition hover:text-rim-danger"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-[11px] text-rim-text-muted">
                  Delay after previous step (seconds)
                </label>
                <input
                  type="number"
                  min={0}
                  value={step.delaySeconds}
                  aria-label="Delay (seconds)"
                  onChange={(e) => updateStep(index, { delaySeconds: Number(e.target.value) })}
                  className="w-full rounded border border-rim-line bg-rim-void px-2 py-1 text-sm text-rim-text outline-none focus:border-rim-accent"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-rim-text-muted">Target</label>
                <select
                  value={step.targetKind}
                  aria-label="Target kind"
                  onChange={(e) =>
                    updateStep(index, { targetKind: e.target.value as EscalationTargetKindGql })
                  }
                  className="w-full rounded border border-rim-line bg-rim-void px-2 py-1 text-sm text-rim-text outline-none focus:border-rim-accent"
                >
                  <option value={EscalationTargetKindGql.ON_CALL}>On-call schedule</option>
                  <option value={EscalationTargetKindGql.USER}>Specific user</option>
                </select>
              </div>

              {step.targetKind === EscalationTargetKindGql.USER ? (
                <div className="col-span-2">
                  <label className="mb-1 block text-[11px] text-rim-text-muted">User</label>
                  <select
                    value={step.targetUserId}
                    aria-label="Target user"
                    onChange={(e) => updateStep(index, { targetUserId: e.target.value })}
                    className="w-full rounded border border-rim-line bg-rim-void px-2 py-1 text-sm text-rim-text outline-none focus:border-rim-accent"
                  >
                    <option value="">Select user…</option>
                    {(members ?? []).map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.displayName || m.username}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="col-span-2">
                  <label className="mb-1 block text-[11px] text-rim-text-muted">Schedule</label>
                  <select
                    value={step.targetScheduleId}
                    aria-label="Target schedule"
                    onChange={(e) => updateStep(index, { targetScheduleId: e.target.value })}
                    className="w-full rounded border border-rim-line bg-rim-void px-2 py-1 text-sm text-rim-text outline-none focus:border-rim-accent"
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

              <div className="col-span-2">
                <label className="mb-1 block text-[11px] text-rim-text-muted">
                  Actions (at least one required)
                </label>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-1.5 text-xs text-rim-text">
                    <input
                      type="checkbox"
                      checked={step.actions.includes(EscalationActionKindGql.MENTION_IN_CHANNEL)}
                      onChange={() =>
                        toggleAction(index, EscalationActionKindGql.MENTION_IN_CHANNEL)
                      }
                    />
                    Mention in channel
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-rim-text">
                    <input
                      type="checkbox"
                      checked={step.actions.includes(EscalationActionKindGql.EMAIL)}
                      onChange={() => toggleAction(index, EscalationActionKindGql.EMAIL)}
                    />
                    Email
                  </label>
                  {/* PUSH is reserved for a future track — intentionally hidden in C1. */}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => onChange([...steps, makeEmptyDraftStep()])}
        className="rounded px-2 py-1 text-xs text-rim-accent transition hover:bg-rim-accent/10"
      >
        + Add step
      </button>
    </div>
  );
}
