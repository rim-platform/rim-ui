import { useState } from "react";
import { Plus, Trash2, ChevronDown, ChevronUp } from "lucide-react";

import { useCommands } from "../api/useCommands";
import {
  useCreateUserCommandMutation,
  useDeleteUserCommandMutation,
} from "../api/useUserCommands";
import type { UserCommandStepInput } from "../types";

export function UserCommandSettings() {
  const { data: commands } = useCommands("Palette");
  const createMutation = useCreateUserCommandMutation();
  const deleteMutation = useDeleteUserCommandMutation();

  const [showCreate, setShowCreate] = useState(false);
  const [newId, setNewId] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [steps, setSteps] = useState<UserCommandStepInput[]>([]);

  const userCommands = commands?.filter((cmd) => cmd.sourceKind === "User") ?? [];
  const availableCommands =
    commands?.filter((cmd) => cmd.executionTarget === "Backend") ?? [];

  function addStep() {
    setSteps([...steps, { commandId: "" }]);
  }

  function updateStep(index: number, commandId: string) {
    const updated = [...steps];
    updated[index] = { commandId };
    setSteps(updated);
  }

  function removeStep(index: number) {
    setSteps(steps.filter((_, i) => i !== index));
  }

  function moveStep(index: number, direction: "up" | "down") {
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= steps.length) return;
    const updated = [...steps];
    [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
    setSteps(updated);
  }

  function handleCreate() {
    if (!newId || !newTitle || steps.length === 0) return;
    const commandId = newId.startsWith("user.") ? newId : `user.${newId}`;
    createMutation.mutate(
      {
        commandId,
        title: newTitle,
        description: newDescription || newTitle,
        steps: steps.filter((s) => s.commandId),
      },
      {
        onSuccess: () => {
          setShowCreate(false);
          setNewId("");
          setNewTitle("");
          setNewDescription("");
          setSteps([]);
        },
      }
    );
  }

  function handleDelete(commandId: string) {
    deleteMutation.mutate({ commandId });
  }

  return (
    <div className="p-3">
      {/* Add button */}
      <button
        className="mb-3 flex w-full items-center justify-center gap-1.5 rounded-md border border-rim-line bg-rim-void px-3 py-1.5 text-xs text-rim-text-muted hover:text-rim-text transition-colors"
        onClick={() => setShowCreate(!showCreate)}
      >
        <Plus className="h-3.5 w-3.5" />
        Create macro
      </button>

      {/* Create form */}
      {showCreate && (
        <div className="mb-3 rounded-md border border-rim-line bg-rim-void p-3 space-y-2">
          <div>
            <label className="block text-[11px] text-rim-text-muted mb-1">
              Command ID
            </label>
            <div className="flex items-center">
              <span className="text-[11px] text-rim-text-muted mr-1">user.</span>
              <input
                type="text"
                value={newId.replace(/^user\./, "")}
                onChange={(e) => setNewId(e.target.value)}
                placeholder="my_macro"
                className="flex-1 rounded border border-rim-line bg-rim-panel px-2 py-1 text-xs text-rim-text outline-none focus:border-rim-accent placeholder:text-rim-text-muted"
              />
            </div>
          </div>
          <div>
            <label className="block text-[11px] text-rim-text-muted mb-1">
              Title
            </label>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="My Macro"
              className="w-full rounded border border-rim-line bg-rim-panel px-2 py-1 text-xs text-rim-text outline-none focus:border-rim-accent placeholder:text-rim-text-muted"
            />
          </div>
          <div>
            <label className="block text-[11px] text-rim-text-muted mb-1">
              Description
            </label>
            <input
              type="text"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="What this macro does..."
              className="w-full rounded border border-rim-line bg-rim-panel px-2 py-1 text-xs text-rim-text outline-none focus:border-rim-accent placeholder:text-rim-text-muted"
            />
          </div>

          {/* Steps */}
          <div>
            <label className="block text-[11px] text-rim-text-muted mb-1">
              Steps ({steps.length})
            </label>
            <div className="space-y-1">
              {steps.map((step, index) => (
                <div key={index} className="flex items-center gap-1">
                  <span className="w-4 shrink-0 text-[10px] text-rim-text-muted">
                    {index + 1}.
                  </span>
                  <select
                    value={step.commandId}
                    onChange={(e) => updateStep(index, e.target.value)}
                    className="min-w-0 flex-1 truncate rounded border border-rim-line bg-rim-panel px-1.5 py-0.5 text-[11px] text-rim-text outline-none focus:border-rim-accent"
                  >
                    <option value="">Select...</option>
                    {availableCommands.map((cmd) => (
                      <option key={cmd.id} value={cmd.id}>
                        {cmd.title}
                      </option>
                    ))}
                  </select>
                  <div className="flex shrink-0 items-center">
                    <button
                      onClick={() => moveStep(index, "up")}
                      disabled={index === 0}
                      className="p-0.5 text-rim-text-muted hover:text-rim-text disabled:opacity-30"
                    >
                      <ChevronUp className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => moveStep(index, "down")}
                      disabled={index === steps.length - 1}
                      className="p-0.5 text-rim-text-muted hover:text-rim-text disabled:opacity-30"
                    >
                      <ChevronDown className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => removeStep(index)}
                      className="p-0.5 text-rim-text-muted hover:text-red-400"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={addStep}
              className="mt-1 text-[11px] text-rim-accent hover:text-rim-accent/80"
            >
              + Add step
            </button>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleCreate}
              disabled={
                !newId || !newTitle || steps.length === 0 || createMutation.isPending
              }
              className="flex-1 rounded bg-rim-accent px-2 py-1 text-xs font-medium text-rim-void hover:bg-rim-accent/90 disabled:opacity-50"
            >
              {createMutation.isPending ? "Creating..." : "Create"}
            </button>
            <button
              onClick={() => {
                setShowCreate(false);
                setSteps([]);
              }}
              className="rounded px-2 py-1 text-xs text-rim-text-muted hover:text-rim-text"
            >
              Cancel
            </button>
          </div>
          {createMutation.isError && (
            <p className="text-[11px] text-red-400">
              {(createMutation.error as Error).message}
            </p>
          )}
        </div>
      )}

      {/* Existing user commands */}
      <div className="space-y-1">
        {userCommands.length === 0 && (
          <p className="text-xs text-rim-text-muted py-4 text-center">
            No macros created yet.
          </p>
        )}
        {userCommands.map((cmd) => (
          <div
            key={cmd.id}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-rim-text"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{cmd.title}</div>
              <div className="truncate font-mono text-[10px] text-rim-text-muted">
                {cmd.id}
              </div>
            </div>
            <button
              onClick={() => handleDelete(cmd.id)}
              className="shrink-0 text-rim-text-muted hover:text-red-400"
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
