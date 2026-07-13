import { useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "../../../shared/ui/Button";
import { toast } from "../../../shared/toast";
import { useCanManageOnCall } from "../../workspaces/api/useMyServerRole";
import { useChannels } from "../../conversations/api/useChannels";
import {
  useEscalationPolicies,
  useSetChannelEscalationPolicy,
  type EscalationPolicy,
} from "../api/useEscalationPolicies";
import { EscalationPolicyEditor } from "./EscalationPolicyEditor";
import { EscalationTargetKindGql } from "../../../core/graphql/generated/schema-types";

function formatDelay(seconds: number): string {
  if (seconds === 0) return "immediately";
  if (seconds % 3600 === 0) return `${seconds / 3600}h after previous`;
  if (seconds % 60 === 0) return `${seconds / 60}m after previous`;
  return `${seconds}s after previous`;
}

function PolicyStepper({ policy }: { policy: EscalationPolicy }) {
  const steps = [...policy.steps].sort((a, b) => a.position - b.position);
  return (
    <div className="space-y-1">
      {steps.map((step, i) => (
        <div key={step.id} className="text-xs text-rim-text-muted">
          <span className="font-mono text-rim-text">L{i + 1}</span> {formatDelay(step.delaySeconds)}
          {" → "}
          <span className="text-rim-text">
            {step.targetKind === EscalationTargetKindGql.USER
              ? `user ${step.targetUserId?.slice(0, 8)}`
              : `on-call schedule ${step.targetScheduleId?.slice(0, 8)}`}
          </span>
        </div>
      ))}
    </div>
  );
}

function ChannelDefaultPolicyForm({ serverId }: { serverId: string }) {
  const { data: channelsData } = useChannels(serverId);
  const { data: policies } = useEscalationPolicies(serverId);
  const setChannelPolicy = useSetChannelEscalationPolicy();
  const [conversationId, setConversationId] = useState("");
  const [policyId, setPolicyId] = useState("");

  const handleSave = () => {
    if (!conversationId || !policyId) return;
    setChannelPolicy.mutate(
      { serverId, conversationId, policyId },
      {
        onSuccess: () => toast.success("Channel default policy set"),
        onError: () => toast.error("Failed to set channel policy"),
      },
    );
  };

  return (
    <div className="space-y-3 rounded-lg border border-rim-line bg-rim-panel p-3">
      <h3 className="text-sm font-medium text-rim-text">Channel default policies</h3>
      <p className="text-xs text-rim-text-faint">
        Sets the escalation policy a channel's incidents use by default (overridable per incident).
        There's no query yet to list a channel's current binding — this only sets new ones.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <select
          value={conversationId}
          onChange={(e) => setConversationId(e.target.value)}
          aria-label="Channel"
          className="rounded border border-rim-line bg-rim-void px-2 py-1.5 text-sm text-rim-text outline-none focus:border-rim-accent"
        >
          <option value="">Select channel…</option>
          {(channelsData?.items ?? []).map((ch) => (
            <option key={ch.id} value={ch.id}>
              # {ch.title ?? ch.id}
            </option>
          ))}
        </select>
        <select
          value={policyId}
          onChange={(e) => setPolicyId(e.target.value)}
          aria-label="Policy"
          className="rounded border border-rim-line bg-rim-void px-2 py-1.5 text-sm text-rim-text outline-none focus:border-rim-accent"
        >
          <option value="">Select policy…</option>
          {(policies ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <Button
        variant="secondary"
        size="sm"
        onClick={handleSave}
        disabled={!conversationId || !policyId || setChannelPolicy.isPending}
        isLoading={setChannelPolicy.isPending}
      >
        Save
      </Button>
    </div>
  );
}

interface EscalationSubTabProps {
  serverId: string;
}

/** Escalation sub-tab of the Incidents hub: policy list (read-only stepper preview),
 * create/edit (canManageOnCall), and the channel-default-policy binding control. */
export function EscalationSubTab({ serverId }: EscalationSubTabProps) {
  const { data: policies, isPending } = useEscalationPolicies(serverId);
  const canManage = useCanManageOnCall(serverId);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<EscalationPolicy | null>(null);

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-rim-text">Escalation policies</h2>
        {canManage && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex items-center gap-1 rounded bg-rim-accent px-2 py-1 text-xs font-medium text-rim-void transition hover:bg-rim-accent/90"
          >
            <Plus className="h-3.5 w-3.5" /> Create policy
          </button>
        )}
      </div>

      {isPending && <p className="text-sm text-rim-text-muted">Loading policies…</p>}
      {!isPending && (!policies || policies.length === 0) && (
        <p className="text-sm text-rim-text-faint">No escalation policies yet.</p>
      )}

      <div className="space-y-2">
        {(policies ?? []).map((policy) => (
          <div key={policy.id} className="rounded-lg border border-rim-line bg-rim-void p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-rim-text">{policy.name}</p>
              {canManage && (
                <button
                  type="button"
                  onClick={() => setEditing(policy)}
                  className="rounded px-2 py-1 text-xs text-rim-text-muted transition hover:bg-white/5 hover:text-rim-text"
                >
                  Edit
                </button>
              )}
            </div>
            <PolicyStepper policy={policy} />
          </div>
        ))}
      </div>

      {canManage && <ChannelDefaultPolicyForm serverId={serverId} />}

      {creating && (
        <EscalationPolicyEditor
          open={creating}
          onClose={() => setCreating(false)}
          serverId={serverId}
        />
      )}
      {editing && (
        <EscalationPolicyEditor
          open={Boolean(editing)}
          onClose={() => setEditing(null)}
          serverId={serverId}
          existing={editing}
        />
      )}
    </div>
  );
}
