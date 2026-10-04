import { useState, useCallback } from "react";
import { Plus, Pencil, Trash2, Power, ChevronDown, X } from "lucide-react";

import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import {
  usePipelines,
  useCreatePipelineMutation,
  useUpdatePipelineMutation,
  useDeletePipelineMutation,
  useTogglePipelineMutation,
} from "../api/usePipelines";
import type { Pipeline, CreatePipelineInput, UpdatePipelineInput } from "../api/usePipelines";
import { useCommands } from "../../commands/api/useCommands";
import { CommandIdInput } from "../../commands/components/CommandIdInput";
import { PipelineTriggerKindGql } from "../../../core/graphql/generated/schema-types";
import { cn } from "../../../shared/ui/cn";
import { toast } from "../../../shared/toast";

const TRIGGER_OPTIONS: { value: PipelineTriggerKindGql; label: string }[] = [
  { value: PipelineTriggerKindGql.NEW_MESSAGE, label: "New Message" },
  { value: PipelineTriggerKindGql.MESSAGE_UPDATED, label: "Message Updated" },
  { value: PipelineTriggerKindGql.MESSAGE_DELETED, label: "Message Deleted" },
  { value: PipelineTriggerKindGql.REACTIONS_UPDATED, label: "Reactions Updated" },
  { value: PipelineTriggerKindGql.MEMBER_JOINED, label: "Member Joined" },
  { value: PipelineTriggerKindGql.WORKSPACE_STATE_CHANGED, label: "Workspace State Changed" },
];

const CONDITION_TYPES = [
  { value: "MessageContains", label: "Message contains pattern" },
  { value: "MessageFromUser", label: "Message from user" },
  { value: "ConversationIs", label: "In conversation" },
];

interface ActionDraft {
  commandId: string;
  args: string;
}

interface ConditionDraft {
  conditionType: string;
  pattern: string;
  userId: string;
  conversationId: string;
}

interface PipelineEditorProps {
  initial?: Pipeline;
  serverId: string;
  onSave: () => void;
  onCancel: () => void;
}

function PipelineEditor({ initial, serverId, onSave, onCancel }: PipelineEditorProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [triggerKind, setTriggerKind] = useState<PipelineTriggerKindGql>(
    initial?.trigger.kind ?? PipelineTriggerKindGql.NEW_MESSAGE,
  );
  const [triggerConversationId, setTriggerConversationId] = useState(
    initial?.trigger.conversationId ?? "",
  );
  const [cooldownSecs, setCooldownSecs] = useState<string>(
    initial?.cooldownSecs != null ? String(initial.cooldownSecs) : "",
  );
  const [conditions, setConditions] = useState<ConditionDraft[]>(() => {
    if (!initial?.filter?.conditions.length) return [];
    return initial.filter.conditions.map((c) => ({
      conditionType: c.conditionType,
      pattern: c.pattern ?? "",
      userId: c.userId ?? "",
      conversationId: c.conversationId ?? "",
    }));
  });
  const [actions, setActions] = useState<ActionDraft[]>(() => {
    if (!initial?.actions.length) return [{ commandId: "", args: "" }];
    return initial.actions.map((a) => ({
      commandId: a.commandId ?? "",
      args: a.args ? JSON.stringify(a.args) : "",
    }));
  });

  const { data: allCommands } = useCommands("PALETTE");
  const createPipeline = useCreatePipelineMutation();
  const updatePipeline = useUpdatePipelineMutation();

  const addAction = useCallback(() => {
    if (actions.length >= 10) return;
    setActions((prev) => [...prev, { commandId: "", args: "" }]);
  }, [actions.length]);

  const removeAction = useCallback((index: number) => {
    setActions((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateAction = useCallback((index: number, field: "commandId" | "args", value: string) => {
    setActions((prev) => prev.map((a, i) => (i === index ? { ...a, [field]: value } : a)));
  }, []);

  const addCondition = useCallback(() => {
    if (conditions.length >= 5) return;
    setConditions((prev) => [
      ...prev,
      { conditionType: "MessageContains", pattern: "", userId: "", conversationId: "" },
    ]);
  }, [conditions.length]);

  const removeCondition = useCallback((index: number) => {
    setConditions((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateCondition = useCallback(
    (index: number, field: keyof ConditionDraft, value: string) => {
      setConditions((prev) => prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)));
    },
    [],
  );

  const handleSave = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const validActions = actions.filter((a) => a.commandId.trim() !== "");
    if (validActions.length === 0) return;

    const trigger = {
      kind: triggerKind,
      conversationId: triggerConversationId.trim() || undefined,
    };

    const filter =
      conditions.length > 0
        ? {
            conditions: conditions.map((c) => ({
              conditionType: c.conditionType,
              pattern: c.pattern.trim() || undefined,
              userId: c.userId.trim() || undefined,
              conversationId: c.conversationId.trim() || undefined,
            })),
          }
        : undefined;

    const mappedActions = validActions.map((a) => {
      let args: unknown = undefined;
      if (a.args.trim()) {
        try {
          args = JSON.parse(a.args);
        } catch {
          toast.error(`Invalid JSON in args for action "${a.commandId}"`);
        }
      }
      return { commandId: a.commandId.trim(), args };
    });

    const parsedCd = cooldownSecs.trim() ? parseInt(cooldownSecs, 10) : undefined;
    const cd =
      parsedCd !== undefined && !Number.isNaN(parsedCd) && parsedCd >= 0 ? parsedCd : undefined;

    try {
      if (initial) {
        const input: UpdatePipelineInput = {
          pipelineId: initial.id,
          name: trimmedName,
          description: description.trim() || undefined,
          trigger,
          filter,
          actions: mappedActions,
          cooldownSecs: cd,
        };
        await updatePipeline.mutateAsync(input);
      } else {
        const input: CreatePipelineInput = {
          serverId,
          name: trimmedName,
          description: description.trim() || undefined,
          trigger,
          filter,
          actions: mappedActions,
          cooldownSecs: cd,
        };
        await createPipeline.mutateAsync(input);
      }
      onSave();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save pipeline");
    }
  }, [
    name,
    description,
    triggerKind,
    triggerConversationId,
    cooldownSecs,
    conditions,
    actions,
    initial,
    serverId,
    createPipeline,
    updatePipeline,
    onSave,
  ]);

  const isSaving = createPipeline.isPending || updatePipeline.isPending;

  return (
    <div className="space-y-5">
      {/* Name */}
      <div>
        <label className="mb-1 block text-sm font-medium text-rim-text">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My pipeline"
          className="w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none focus:border-rim-accent"
        />
      </div>

      {/* Description */}
      <div>
        <label className="mb-1 block text-sm font-medium text-rim-text">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What does this pipeline do?"
          rows={2}
          className="w-full resize-none rounded-lg border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none focus:border-rim-accent"
        />
      </div>

      {/* Trigger */}
      <div>
        <label className="mb-1 block text-sm font-medium text-rim-text">Trigger</label>
        <div className="space-y-2">
          <div className="relative">
            <select
              value={triggerKind}
              onChange={(e) => setTriggerKind(e.target.value as PipelineTriggerKindGql)}
              className="w-full appearance-none rounded-lg border border-rim-line bg-rim-void px-3 py-2 pr-8 text-sm text-rim-text outline-none focus:border-rim-accent"
            >
              {TRIGGER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-rim-text-muted" />
          </div>
          <input
            type="text"
            value={triggerConversationId}
            onChange={(e) => setTriggerConversationId(e.target.value)}
            placeholder="Scope to conversation ID (optional)"
            className="w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none focus:border-rim-accent"
          />
        </div>
      </div>

      {/* Filter conditions */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-sm font-medium text-rim-text">
            Filters ({conditions.length}/5)
          </label>
          <button
            type="button"
            onClick={addCondition}
            disabled={conditions.length >= 5}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-rim-accent transition hover:bg-rim-accent/10 disabled:opacity-40"
          >
            <Plus className="h-3 w-3" /> Add filter
          </button>
        </div>
        {conditions.length === 0 && (
          <p className="text-xs text-rim-text-faint">
            No filters — pipeline will fire on every matching trigger.
          </p>
        )}
        <div className="space-y-2">
          {conditions.map((cond, index) => (
            <div
              key={index}
              className="flex items-start gap-2 rounded-lg border border-rim-line bg-rim-void p-3"
            >
              <div className="flex-1 space-y-2">
                <div className="relative">
                  <select
                    value={cond.conditionType}
                    onChange={(e) => updateCondition(index, "conditionType", e.target.value)}
                    className="w-full appearance-none rounded border border-rim-line bg-rim-panel px-2 py-1.5 pr-8 text-sm text-rim-text outline-none focus:border-rim-accent"
                  >
                    {CONDITION_TYPES.map((ct) => (
                      <option key={ct.value} value={ct.value}>
                        {ct.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-rim-text-muted" />
                </div>
                {cond.conditionType === "MessageContains" && (
                  <input
                    type="text"
                    value={cond.pattern}
                    onChange={(e) => updateCondition(index, "pattern", e.target.value)}
                    placeholder="Pattern (e.g. urgent)"
                    className="w-full rounded border border-rim-line bg-rim-panel px-2 py-1.5 text-sm text-rim-text outline-none focus:border-rim-accent"
                  />
                )}
                {cond.conditionType === "MessageFromUser" && (
                  <input
                    type="text"
                    value={cond.userId}
                    onChange={(e) => updateCondition(index, "userId", e.target.value)}
                    placeholder="User ID"
                    className="w-full rounded border border-rim-line bg-rim-panel px-2 py-1.5 text-sm text-rim-text outline-none focus:border-rim-accent"
                  />
                )}
                {cond.conditionType === "ConversationIs" && (
                  <input
                    type="text"
                    value={cond.conversationId}
                    onChange={(e) => updateCondition(index, "conversationId", e.target.value)}
                    placeholder="Conversation ID"
                    className="w-full rounded border border-rim-line bg-rim-panel px-2 py-1.5 text-sm text-rim-text outline-none focus:border-rim-accent"
                  />
                )}
              </div>
              <button
                type="button"
                onClick={() => removeCondition(index)}
                className="mt-1 rounded p-0.5 text-rim-text-muted transition hover:text-rim-danger"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-sm font-medium text-rim-text">Actions ({actions.length}/10)</label>
          <button
            type="button"
            onClick={addAction}
            disabled={actions.length >= 10}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-rim-accent transition hover:bg-rim-accent/10 disabled:opacity-40"
          >
            <Plus className="h-3 w-3" /> Add action
          </button>
        </div>
        <div className="space-y-2">
          {actions.map((action, index) => (
            <div
              key={index}
              className="flex items-start gap-2 rounded-lg border border-rim-line bg-rim-void p-3"
            >
              <span className="mt-1 font-mono text-xs text-rim-text-muted">{index + 1}.</span>
              <div className="flex-1 space-y-2">
                <CommandIdInput
                  value={action.commandId}
                  onChange={(v) => updateAction(index, "commandId", v)}
                  commands={allCommands}
                />
                <input
                  type="text"
                  value={action.args}
                  onChange={(e) => updateAction(index, "args", e.target.value)}
                  placeholder='{"key": "value"} (optional)'
                  className="w-full rounded border border-rim-line bg-rim-panel px-2 py-1.5 font-mono text-xs text-rim-text-muted outline-none focus:border-rim-accent"
                />
              </div>
              <button
                type="button"
                onClick={() => removeAction(index)}
                disabled={actions.length <= 1}
                className="mt-1 rounded p-0.5 text-rim-text-muted transition hover:text-rim-danger disabled:opacity-30"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Cooldown */}
      <div>
        <label className="mb-1 block text-sm font-medium text-rim-text">
          Cooldown (seconds, optional)
        </label>
        <input
          type="number"
          min={0}
          value={cooldownSecs}
          onChange={(e) => setCooldownSecs(e.target.value)}
          placeholder="e.g. 60"
          className="w-32 rounded-lg border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none focus:border-rim-accent"
        />
      </div>

      {/* Save / Cancel */}
      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving || !name.trim()}
          className="rounded-lg bg-rim-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-rim-accent/90 disabled:opacity-50"
        >
          {isSaving ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-rim-line px-4 py-2 text-sm text-rim-text-muted transition hover:bg-rim-void/50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function triggerLabel(kind: PipelineTriggerKindGql): string {
  return TRIGGER_OPTIONS.find((o) => o.value === kind)?.label ?? kind;
}

export function PipelineSettings() {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const { data: pipelines, isLoading } = usePipelines(workspaceId ?? undefined);
  const deletePipeline = useDeletePipelineMutation();
  const togglePipeline = useTogglePipelineMutation();

  const [editing, setEditing] = useState<Pipeline | "new" | null>(null);

  const handleDelete = useCallback(
    async (pipelineId: string, pipelineName: string) => {
      if (!workspaceId) return;
      const confirmed = window.confirm(`Delete pipeline "${pipelineName}"? This cannot be undone.`);
      if (!confirmed) return;
      try {
        await deletePipeline.mutateAsync({ pipelineId, serverId: workspaceId });
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to delete pipeline");
      }
    },
    [deletePipeline, workspaceId],
  );

  const handleToggle = useCallback(
    async (pipelineId: string, enabled: boolean) => {
      if (!workspaceId) return;
      try {
        await togglePipeline.mutateAsync({ pipelineId, enabled, serverId: workspaceId });
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to toggle pipeline");
      }
    },
    [togglePipeline, workspaceId],
  );

  if (editing !== null) {
    const isNew = editing === "new";
    return (
      <div>
        <h2 className="mb-4 text-base font-semibold text-rim-text">
          {isNew ? "Create Pipeline" : `Edit: ${editing.name}`}
        </h2>
        <PipelineEditor
          initial={isNew ? undefined : editing}
          serverId={workspaceId ?? ""}
          onSave={() => setEditing(null)}
          onCancel={() => setEditing(null)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-rim-text">Pipelines</h2>
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="flex items-center gap-1 rounded-lg bg-rim-accent px-3 py-1.5 text-sm font-medium text-white transition hover:bg-rim-accent/90"
        >
          <Plus className="h-4 w-4" /> New Pipeline
        </button>
      </div>

      {isLoading && <p className="text-sm text-rim-text-muted">Loading pipelines...</p>}

      {!isLoading && (!pipelines || pipelines.length === 0) && (
        <p className="text-sm text-rim-text-muted">
          No pipelines yet. Create one to react to workspace events automatically.
        </p>
      )}

      {pipelines && pipelines.length > 0 && (
        <div className="divide-y divide-rim-line rounded-lg border border-rim-line">
          {pipelines.map((pipeline) => (
            <div key={pipeline.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-rim-text">{pipeline.name}</span>
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                      pipeline.enabled
                        ? "bg-rim-success/15 text-rim-success"
                        : "bg-rim-text-faint/15 text-rim-text-faint",
                    )}
                  >
                    {pipeline.enabled ? "Active" : "Disabled"}
                  </span>
                </div>
                {pipeline.description && (
                  <div className="truncate text-xs text-rim-text-muted">{pipeline.description}</div>
                )}
                <div className="flex items-center gap-3 text-xs text-rim-text-faint">
                  <span>Trigger: {triggerLabel(pipeline.trigger.kind)}</span>
                  <span>
                    {pipeline.actions.length} action{pipeline.actions.length !== 1 ? "s" : ""}
                  </span>
                  {pipeline.lastFiredAt && (
                    <span>Last fired: {new Date(pipeline.lastFiredAt).toLocaleString()}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleToggle(pipeline.id, !pipeline.enabled)}
                  title={pipeline.enabled ? "Disable pipeline" : "Enable pipeline"}
                  className={cn(
                    "rounded-md p-1.5 transition",
                    pipeline.enabled
                      ? "text-rim-success hover:bg-rim-success/10"
                      : "text-rim-text-muted hover:bg-rim-void/50",
                  )}
                >
                  <Power className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(pipeline)}
                  title="Edit pipeline"
                  className="rounded-md p-1.5 text-rim-text-muted transition hover:bg-rim-void/50 hover:text-rim-text"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(pipeline.id, pipeline.name)}
                  title="Delete pipeline"
                  className="rounded-md p-1.5 text-rim-text-muted transition hover:bg-rim-danger/10 hover:text-rim-danger"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
