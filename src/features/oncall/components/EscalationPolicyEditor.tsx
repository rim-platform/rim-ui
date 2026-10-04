import { useCallback, useState } from "react";

import { Button } from "../../../shared/ui/Button";
import { Dialog } from "../../../shared/ui/Dialog";
import { toast } from "../../../shared/toast";
import {
  useCreateEscalationPolicy,
  useUpdateEscalationPolicy,
  type EscalationPolicy,
} from "../api/useEscalationPolicies";
import {
  EscalationStepList,
  makeEmptyDraftStep,
  type DraftEscalationStep,
} from "./EscalationStepList";
import {
  EscalationTargetKindGql,
  type EscalationStepInputGql,
} from "../../../core/graphql/generated/schema-types";

function toDraftSteps(policy?: EscalationPolicy): DraftEscalationStep[] {
  if (!policy) return [makeEmptyDraftStep()];
  return [...policy.steps]
    .sort((a, b) => a.position - b.position)
    .map((s) => ({
      delaySeconds: s.delaySeconds,
      targetKind: s.targetKind,
      targetUserId: s.targetUserId ?? "",
      targetScheduleId: s.targetScheduleId ?? "",
      actions: s.actions,
    }));
}

function toStepInput(step: DraftEscalationStep): EscalationStepInputGql {
  return {
    delaySeconds: step.delaySeconds,
    target:
      step.targetKind === EscalationTargetKindGql.USER
        ? { kind: EscalationTargetKindGql.USER, userId: step.targetUserId }
        : { kind: EscalationTargetKindGql.ON_CALL, scheduleId: step.targetScheduleId },
    actions: step.actions,
  };
}

function stepIsValid(step: DraftEscalationStep): boolean {
  if (step.actions.length === 0) return false;
  if (step.targetKind === EscalationTargetKindGql.USER) return Boolean(step.targetUserId);
  return Boolean(step.targetScheduleId);
}

interface EscalationPolicyEditorProps {
  open: boolean;
  onClose: () => void;
  serverId: string;
  existing?: EscalationPolicy;
}

/**
 * Create/edit an escalation policy (Owner/Moderator only — the caller gates the entry
 * point on `canManageOnCall`; the backend re-enforces regardless). `steps` is replaced
 * atomically on save (no per-step id tracking needed client-side).
 */
export function EscalationPolicyEditor({
  open,
  onClose,
  serverId,
  existing,
}: EscalationPolicyEditorProps) {
  const [name, setName] = useState(existing?.name ?? "");
  const [steps, setSteps] = useState<DraftEscalationStep[]>(() => toDraftSteps(existing));
  const [saving, setSaving] = useState(false);

  const createPolicy = useCreateEscalationPolicy();
  const updatePolicy = useUpdateEscalationPolicy();

  const reset = useCallback(() => {
    setName(existing?.name ?? "");
    setSteps(toDraftSteps(existing));
  }, [existing]);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const validSteps = steps.filter(stepIsValid);
  const canSave = name.trim() && validSteps.length === steps.length && steps.length > 0;

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const stepInputs = steps.map(toStepInput);
      if (existing) {
        await updatePolicy.mutateAsync({
          serverId,
          policyId: existing.id,
          name: name.trim(),
          steps: stepInputs,
        });
        toast.success("Escalation policy updated");
      } else {
        await createPolicy.mutateAsync({ serverId, name: name.trim(), steps: stepInputs });
        toast.success("Escalation policy created");
      }
      handleClose();
    } catch {
      toast.error(existing ? "Failed to update policy" : "Failed to create policy");
    } finally {
      setSaving(false);
    }
  }, [canSave, steps, existing, serverId, name, createPolicy, updatePolicy, handleClose]);

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={existing ? "Edit escalation policy" : "Create escalation policy"}
      maxWidth="max-w-xl"
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-[11px] text-rim-text-muted">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Default SEV1 escalation"
            className="w-full rounded border border-rim-line bg-rim-void px-2 py-1.5 text-sm text-rim-text outline-none focus:border-rim-accent"
          />
        </div>

        <EscalationStepList serverId={serverId} steps={steps} onChange={setSteps} />

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            disabled={!canSave || saving}
            isLoading={saving}
          >
            {existing ? "Save" : "Create"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
