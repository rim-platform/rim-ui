import { useState, useCallback } from "react";
import { Plus, Pencil, Trash2, Play, ChevronUp, ChevronDown, X, Wand2, Loader2 } from "lucide-react";

import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import {
  useMyMacros,
  useCreateMacroMutation,
  useUpdateMacroMutation,
  useDeleteMacroMutation,
  useExecuteMacroMutation,
} from "../api/useMacros";
import type { Macro, MacroStep } from "../api/useMacros";
import { useCommands } from "../../commands/api/useCommands";
import { CommandIdInput } from "../../commands/components/CommandIdInput";
import { cn } from "../../../shared/ui/cn";
import { toast } from "../../../shared/toast";
import { AiMacroBuilder } from "./AiMacroBuilder";
import type { GeneratedMacro } from "../runtime/useMacroAgent";

const MAX_STEPS = 20;

interface MacroEditorProps {
  initial?: Macro;
  initialSteps?: MacroStep[];
  initialName?: string;
  initialDescription?: string;
  serverId: string;
  onSave: () => void;
  onCancel: () => void;
}

function MacroEditor({
  initial,
  initialSteps,
  initialName,
  initialDescription,
  serverId,
  onSave,
  onCancel,
}: MacroEditorProps) {
  const [name, setName] = useState(initial?.name ?? initialName ?? "");
  const [description, setDescription] = useState(initial?.description ?? initialDescription ?? "");
  const [steps, setSteps] = useState<MacroStep[]>(
    initial?.steps ?? initialSteps ?? [{ commandId: "", args: {} }],
  );

  const { data: commands } = useCommands("PALETTE");
  const createMacro = useCreateMacroMutation();
  const updateMacro = useUpdateMacroMutation();

  const addStep = useCallback(() => {
    if (steps.length >= MAX_STEPS) return;
    setSteps((prev) => [...prev, { commandId: "", args: {} }]);
  }, [steps.length]);

  const removeStep = useCallback((index: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const moveStep = useCallback((index: number, direction: "up" | "down") => {
    setSteps((prev) => {
      const next = [...prev];
      const target = direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  const updateStep = useCallback((index: number, field: "commandId" | "args", value: string) => {
    setSteps((prev) =>
      prev.map((step, i) => {
        if (i !== index) return step;
        if (field === "commandId") return { ...step, commandId: value };
        try {
          return { ...step, args: JSON.parse(value) as Record<string, unknown> };
        } catch {
          return step;
        }
      }),
    );
  }, []);

  const handleSave = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const validSteps = steps.filter((s) => s.commandId.trim() !== "");
    if (validSteps.length === 0) return;

    try {
      if (initial) {
        await updateMacro.mutateAsync({
          macroId: initial.id,
          name: trimmedName,
          description: description.trim(),
          steps: validSteps,
        });
      } else {
        await createMacro.mutateAsync({
          serverId,
          name: trimmedName,
          description: description.trim(),
          steps: validSteps,
        });
      }
      onSave();
    } catch {
      toast.error(initial ? "Failed to update macro" : "Failed to create macro");
    }
  }, [name, description, steps, initial, serverId, createMacro, updateMacro, onSave]);

  const isSaving = createMacro.isPending || updateMacro.isPending;

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-rim-text">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My macro"
          className="w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none focus:border-rim-accent"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-rim-text">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What does this macro do?"
          rows={2}
          className="w-full resize-none rounded-lg border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none focus:border-rim-accent"
        />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-sm font-medium text-rim-text">
            Steps ({steps.length}/{MAX_STEPS})
          </label>
          <button
            type="button"
            onClick={addStep}
            disabled={steps.length >= MAX_STEPS}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-rim-accent transition hover:bg-rim-accent/10 disabled:opacity-40"
          >
            <Plus className="h-3 w-3" /> Add step
          </button>
        </div>

        <div className="space-y-2">
          {steps.map((step, index) => (
            <div
              key={index}
              className="flex items-start gap-2 rounded-lg border border-rim-line bg-rim-void p-3"
            >
              <span className="mt-1 text-xs font-mono text-rim-text-muted">{index + 1}.</span>
              <div className="flex-1 space-y-2">
                <CommandIdInput
                  value={step.commandId}
                  onChange={(v) => updateStep(index, "commandId", v)}
                  commands={commands}
                  placeholder="Search commands..."
                />
                <input
                  type="text"
                  defaultValue={step.args != null && typeof step.args === "object" && Object.keys(step.args as Record<string, unknown>).length > 0 ? JSON.stringify(step.args) : ""}
                  onBlur={(e) => updateStep(index, "args", e.target.value || "{}")}
                  placeholder='{"key": "value"}'
                  className="w-full rounded border border-rim-line bg-rim-panel px-2 py-1.5 text-xs font-mono text-rim-text-muted outline-none focus:border-rim-accent"
                />
              </div>
              <div className="flex flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => moveStep(index, "up")}
                  disabled={index === 0}
                  className="rounded p-0.5 text-rim-text-muted transition hover:text-rim-text disabled:opacity-30"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => moveStep(index, "down")}
                  disabled={index === steps.length - 1}
                  className="rounded p-0.5 text-rim-text-muted transition hover:text-rim-text disabled:opacity-30"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => removeStep(index)}
                  disabled={steps.length <= 1}
                  className="rounded p-0.5 text-rim-text-muted transition hover:text-rim-danger disabled:opacity-30"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

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

interface PendingAiMacro {
  name: string;
  description: string;
  steps: MacroStep[];
}

export function MacroSettings() {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const { data: macros, isLoading } = useMyMacros(workspaceId ?? undefined);
  const deleteMacro = useDeleteMacroMutation();
  const executeMacro = useExecuteMacroMutation();

  const [editing, setEditing] = useState<Macro | "new" | null>(null);
  const [aiBuilderOpen, setAiBuilderOpen] = useState(false);
  const [pendingAiMacro, setPendingAiMacro] = useState<PendingAiMacro | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [executingId, setExecutingId] = useState<string | null>(null);

  const handleAiStepsGenerated = useCallback((macro: GeneratedMacro) => {
    setPendingAiMacro({
      name: macro.name,
      description: macro.description,
      steps: macro.steps,
    });
    setEditing("new");
  }, []);

  const handleDelete = useCallback(
    async (macroId: string) => {
      try {
        await deleteMacro.mutateAsync(macroId);
        toast.success("Macro deleted");
        setConfirmDeleteId(null);
      } catch {
        toast.error("Failed to delete macro");
      }
    },
    [deleteMacro],
  );

  const handleExecute = useCallback(
    async (macroId: string) => {
      setExecutingId(macroId);
      try {
        const result = await executeMacro.mutateAsync({
          macroId,
          commandContext: { workspaceId: workspaceId ?? undefined },
        });
        if (result.executeMacro.status === "SUCCESS") {
          toast.success(result.executeMacro.message || "Macro executed successfully");
        } else {
          toast.error(result.executeMacro.message || "Macro execution failed");
        }
      } catch {
        toast.error("Failed to execute macro");
      } finally {
        setExecutingId(null);
      }
    },
    [executeMacro, workspaceId],
  );

  if (editing !== null) {
    const isNew = editing === "new";
    return (
      <div>
        <h2 className="mb-4 text-base font-semibold text-rim-text">
          {isNew ? "Create Macro" : `Edit: ${editing.name}`}
        </h2>
        <MacroEditor
          initial={isNew ? undefined : editing}
          initialSteps={isNew ? (pendingAiMacro?.steps ?? undefined) : undefined}
          initialName={isNew ? (pendingAiMacro?.name ?? undefined) : undefined}
          initialDescription={isNew ? (pendingAiMacro?.description ?? undefined) : undefined}
          serverId={workspaceId ?? ""}
          onSave={() => {
            setEditing(null);
            setPendingAiMacro(null);
          }}
          onCancel={() => {
            setEditing(null);
            setPendingAiMacro(null);
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-rim-text">Macros</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAiBuilderOpen(true)}
            className="flex items-center gap-1 rounded-lg border border-rim-line px-3 py-1.5 text-sm font-medium text-rim-text-muted transition hover:bg-rim-void/50 hover:text-rim-text"
          >
            <Wand2 className="h-4 w-4" /> Build with AI
          </button>
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="flex items-center gap-1 rounded-lg bg-rim-accent px-3 py-1.5 text-sm font-medium text-white transition hover:bg-rim-accent/90"
          >
            <Plus className="h-4 w-4" /> New Macro
          </button>
        </div>
      </div>

      <AiMacroBuilder
        open={aiBuilderOpen}
        onClose={() => setAiBuilderOpen(false)}
        onStepsGenerated={handleAiStepsGenerated}
      />

      {isLoading && (
        <p className="text-sm text-rim-text-muted">Loading macros...</p>
      )}

      {!isLoading && (!macros || macros.length === 0) && (
        <p className="text-sm text-rim-text-muted">
          No macros yet. Create one to automate a sequence of commands.
        </p>
      )}

      {macros && macros.length > 0 && (
        <div className="divide-y divide-rim-line rounded-lg border border-rim-line">
          {macros.map((macro) => (
            <div
              key={macro.id}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-rim-text">{macro.name}</div>
                {macro.description && (
                  <div className="truncate text-xs text-rim-text-muted">
                    {macro.description}
                  </div>
                )}
                <div className="text-xs text-rim-text-faint">
                  {macro.steps.length} step{macro.steps.length !== 1 ? "s" : ""}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleExecute(macro.id)}
                  disabled={executingId === macro.id}
                  title="Run macro"
                  className={cn(
                    "rounded-md p-1.5 text-rim-text-muted transition",
                    "hover:bg-rim-accent/10 hover:text-rim-accent disabled:opacity-50",
                  )}
                >
                  {executingId === macro.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(macro)}
                  title="Edit macro"
                  className="rounded-md p-1.5 text-rim-text-muted transition hover:bg-rim-void/50 hover:text-rim-text"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                {confirmDeleteId === macro.id ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleDelete(macro.id)}
                      className="rounded-md px-2 py-1 text-xs font-medium text-rim-danger transition hover:bg-rim-danger/10"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      className="rounded-md px-2 py-1 text-xs text-rim-text-muted transition hover:bg-rim-void/50"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(macro.id)}
                    title="Delete macro"
                    className="rounded-md p-1.5 text-rim-text-muted transition hover:bg-rim-danger/10 hover:text-rim-danger"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
