import { useState } from "react";
import { Pencil, Plus, Trash2, ChevronDown, ChevronUp } from "lucide-react";

import { errorSentence, graphqlErrorMessage } from "../../../core/graphql/errors";

import { useCommands } from "../api/useCommands";
import {
  useCreateUserCommandMutation,
  useUpdateUserCommandMutation,
  useDeleteUserCommandMutation,
  useUserCommand,
  useUserCommandSteps,
  type SavedUserCommand,
} from "../api/useUserCommands";
import { serverRunsWithContext, type ArgumentContext } from "../runtime/commandArguments";
import { withClientLabel } from "../runtime/localCommands";
import type { CommandDefinition, UserCommandStepInput } from "../types";

/** The characters a user command id may use after `user.`. */
const USER_COMMAND_KEY_PATTERN = /^[a-z0-9._-]+$/;

/**
 * The context a user command's steps run in: the palette's, with a workspace and, for a
 * command run from a conversation, that conversation. Only its presence matters here.
 */
const STEP_CONTEXT: ArgumentContext = { workspaceId: "open", conversationId: "open" };

/**
 * The steps of a user command being created or edited: a command picker per step, with
 * arrows to reorder, a bin to remove and **+ Add step**. A step's saved arguments are shown
 * under it and kept while its command stays the same.
 *
 * @param steps - The steps in the order they run.
 * @param onChange - Receives the whole new list after each change.
 * @param availableCommands - The commands a step can run.
 */
function StepList({
  steps,
  onChange,
  availableCommands,
}: {
  steps: UserCommandStepInput[];
  onChange: (steps: UserCommandStepInput[]) => void;
  availableCommands: CommandDefinition[];
}) {
  function updateStep(index: number, commandId: string) {
    const updated = [...steps];
    // Arguments belong to the command they were saved for, so a new command starts without.
    updated[index] = { commandId };
    onChange(updated);
  }

  function moveStep(index: number, direction: "up" | "down") {
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= steps.length) return;
    const updated = [...steps];
    [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
    onChange(updated);
  }

  return (
    <div>
      <label className="block text-[11px] text-rim-text-muted mb-1">Steps ({steps.length})</label>
      <div className="space-y-1">
        {steps.map((step, index) => {
          const listed = availableCommands.some((c) => c.id === step.commandId);
          return (
            <div key={index}>
              <div className="flex items-center gap-1">
                <span className="w-4 shrink-0 text-[10px] text-rim-text-muted">{index + 1}.</span>
                <select
                  value={step.commandId}
                  onChange={(e) => updateStep(index, e.target.value)}
                  aria-label={`Step ${index + 1} command`}
                  className="min-w-0 flex-1 truncate rounded border border-rim-line bg-rim-panel px-1.5 py-0.5 text-[11px] text-rim-text outline-none focus:border-rim-accent"
                >
                  <option value="">Select...</option>
                  {/* A saved step whose command is not offered here still shows its id. */}
                  {step.commandId && !listed && (
                    <option value={step.commandId}>{step.commandId}</option>
                  )}
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
                    onClick={() => onChange(steps.filter((_, i) => i !== index))}
                    className="p-0.5 text-rim-text-muted hover:text-rim-danger"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
              {step.args !== undefined && (
                <p className="ml-5 truncate font-mono text-[10px] text-rim-text-muted">
                  Arguments: {JSON.stringify(step.args)}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <button
        onClick={() => onChange([...steps, { commandId: "" }])}
        className="mt-1 text-[11px] text-rim-accent hover:text-rim-accent/80"
      >
        + Add step
      </button>
    </div>
  );
}

/**
 * Converts a saved step to the input shape `updateUserCommand` takes, leaving out empty
 * arguments.
 *
 * @param step - A step as the `userCommand` query returns it.
 * @returns The same command id and arguments as a step input.
 */
function toStepInput(step: SavedUserCommand["steps"][number]): UserCommandStepInput {
  return step.args == null
    ? { commandId: step.commandId }
    : { commandId: step.commandId, args: step.args as Record<string, unknown> };
}

/**
 * The edit form of one user command, filled with its saved title, description and steps.
 * **Save** replaces the saved command and stays off until the title is set and a step is
 * chosen.
 *
 * @param saved - The command as the `userCommand` query returned it.
 * @param availableCommands - The commands a step can run.
 * @param onClose - Called on **Cancel** and after a successful save.
 */
function UserCommandEditor({
  saved,
  availableCommands,
  onClose,
}: {
  saved: SavedUserCommand;
  availableCommands: CommandDefinition[];
  onClose: () => void;
}) {
  const updateMutation = useUpdateUserCommandMutation();
  const [title, setTitle] = useState(saved.title);
  const [description, setDescription] = useState(saved.description);
  const [steps, setSteps] = useState<UserCommandStepInput[]>(() => saved.steps.map(toStepInput));

  // The server refuses a user command without a step, so a step row left on "Select..." does
  // not count towards one.
  const chosenSteps = steps.filter((s) => s.commandId);

  function handleSave() {
    if (!title || chosenSteps.length === 0) return;
    updateMutation.mutate(
      {
        commandId: saved.id,
        title,
        description: description || title,
        steps: chosenSteps,
        isEnabled: saved.isEnabled,
      },
      { onSuccess: onClose },
    );
  }

  return (
    <div className="rounded-md border border-rim-accent/30 bg-rim-void p-3 space-y-2">
      <div>
        <label className="block text-[11px] text-rim-text-muted mb-1">Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Command title"
          className="w-full rounded border border-rim-line bg-rim-panel px-2 py-1 text-xs text-rim-text outline-none focus:border-rim-accent placeholder:text-rim-text-muted"
        />
      </div>
      <div>
        <label className="block text-[11px] text-rim-text-muted mb-1">Description</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What this command does..."
          className="w-full rounded border border-rim-line bg-rim-panel px-2 py-1 text-xs text-rim-text outline-none focus:border-rim-accent placeholder:text-rim-text-muted"
        />
      </div>
      <StepList steps={steps} onChange={setSteps} availableCommands={availableCommands} />
      {chosenSteps.length === 0 && (
        <p className="text-[11px] text-rim-text-muted">Choose at least one step to save.</p>
      )}
      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={!title || chosenSteps.length === 0 || updateMutation.isPending}
          className="flex-1 rounded bg-rim-accent px-2 py-1 text-xs font-medium text-rim-void hover:bg-rim-accent/90 disabled:opacity-50"
        >
          {updateMutation.isPending ? "Saving..." : "Save"}
        </button>
        <button
          onClick={onClose}
          className="rounded px-2 py-1 text-xs text-rim-text-muted hover:text-rim-text"
        >
          Cancel
        </button>
      </div>
      {updateMutation.isError && (
        <p className="text-[11px] text-rim-danger">
          {errorSentence(updateMutation.error, "The command could not be saved.")}
        </p>
      )}
    </div>
  );
}

/**
 * Settings → Commands: creates the signed-in account's user commands, lists them with their
 * step counts, and edits or deletes one. The pencil loads the saved command into the edit
 * form; a command that is gone closes the editor with a notice.
 */
export function UserCommandSettings() {
  const { data: commands } = useCommands("PALETTE");
  const { data: stepSummaries } = useUserCommandSteps();
  const createMutation = useCreateUserCommandMutation();
  const deleteMutation = useDeleteUserCommandMutation();

  const [showCreate, setShowCreate] = useState(false);
  const [newId, setNewId] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [steps, setSteps] = useState<UserCommandStepInput[]>([]);

  const [editingCommandId, setEditingCommandId] = useState<string | null>(null);
  const [goneNotice, setGoneNotice] = useState<string | null>(null);
  const savedQuery = useUserCommand(editingCommandId);

  const userCommands = commands?.filter((cmd) => cmd.sourceKind === "USER") ?? [];
  const availableCommands =
    commands?.filter((cmd) => serverRunsWithContext(cmd, STEP_CONTEXT)).map(withClientLabel) ?? [];
  const key = newId.replace(/^user\./, "");
  const idError =
    key && !USER_COMMAND_KEY_PATTERN.test(key)
      ? "Use lowercase letters, numbers, dots, dashes or underscores."
      : null;
  const chosenSteps = steps.filter((s) => s.commandId);
  const stepCounts = new Map(stepSummaries?.map((c) => [c.id, c.steps.length]));

  // The account has no user command with the id being edited: close the editor and say why.
  if (editingCommandId !== null && savedQuery.data === null) {
    const title = userCommands.find((c) => c.id === editingCommandId)?.title ?? editingCommandId;
    setEditingCommandId(null);
    setGoneNotice(`"${title}" no longer exists for this account, so it cannot be edited.`);
  }

  function handleCreate() {
    if (!newId || !newTitle || chosenSteps.length === 0 || idError) return;
    const commandId = newId.startsWith("user.") ? newId : `user.${newId}`;
    createMutation.mutate(
      {
        commandId,
        title: newTitle,
        description: newDescription || newTitle,
        steps: chosenSteps,
      },
      {
        onSuccess: () => {
          setShowCreate(false);
          setNewId("");
          setNewTitle("");
          setNewDescription("");
          setSteps([]);
        },
      },
    );
  }

  function handleDelete(commandId: string) {
    deleteMutation.mutate({ commandId });
  }

  function startEditingCommand(commandId: string) {
    setGoneNotice(null);
    setEditingCommandId(commandId);
  }

  return (
    <div className="p-3">
      {/* Add button */}
      <button
        className="mb-3 flex w-full items-center justify-center gap-1.5 rounded-md border border-rim-line bg-rim-void px-3 py-1.5 text-xs text-rim-text-muted hover:text-rim-text transition-colors"
        onClick={() => setShowCreate(!showCreate)}
      >
        <Plus className="h-3.5 w-3.5" />
        New command
      </button>

      {/* Create form */}
      {showCreate && (
        <div className="mb-3 rounded-md border border-rim-line bg-rim-void p-3 space-y-2">
          <div>
            <label className="block text-[11px] text-rim-text-muted mb-1">Command ID</label>
            <div className="flex items-center">
              <span className="text-[11px] text-rim-text-muted mr-1">user.</span>
              <input
                type="text"
                value={key}
                onChange={(e) => setNewId(e.target.value)}
                placeholder="catch_up"
                aria-invalid={idError ? "true" : undefined}
                className="flex-1 rounded border border-rim-line bg-rim-panel px-2 py-1 text-xs text-rim-text outline-none focus:border-rim-accent placeholder:text-rim-text-muted"
              />
            </div>
            {idError && <p className="text-[11px] text-rim-danger">{idError}</p>}
          </div>
          <div>
            <label className="block text-[11px] text-rim-text-muted mb-1">Title</label>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Catch up"
              className="w-full rounded border border-rim-line bg-rim-panel px-2 py-1 text-xs text-rim-text outline-none focus:border-rim-accent placeholder:text-rim-text-muted"
            />
          </div>
          <div>
            <label className="block text-[11px] text-rim-text-muted mb-1">Description</label>
            <input
              type="text"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="What this command does..."
              className="w-full rounded border border-rim-line bg-rim-panel px-2 py-1 text-xs text-rim-text outline-none focus:border-rim-accent placeholder:text-rim-text-muted"
            />
          </div>

          <StepList steps={steps} onChange={setSteps} availableCommands={availableCommands} />

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleCreate}
              disabled={
                !newId ||
                !newTitle ||
                chosenSteps.length === 0 ||
                Boolean(idError) ||
                createMutation.isPending
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
            <p className="text-[11px] text-rim-danger">
              {errorSentence(createMutation.error, "The command could not be created.")}
            </p>
          )}
        </div>
      )}

      {goneNotice && (
        <p role="status" className="mb-2 text-[11px] text-rim-danger">
          {goneNotice}
        </p>
      )}

      {/* Existing user commands */}
      <div className="space-y-1">
        {userCommands.length === 0 && (
          <p className="text-xs text-rim-text-muted py-4 text-center">
            No user commands created yet.
          </p>
        )}
        {userCommands.map((cmd) => {
          if (editingCommandId === cmd.id) {
            if (savedQuery.data) {
              return (
                <UserCommandEditor
                  key={cmd.id}
                  saved={savedQuery.data}
                  availableCommands={availableCommands}
                  onClose={() => setEditingCommandId(null)}
                />
              );
            }
            return (
              <div
                key={cmd.id}
                className="flex items-center gap-2 rounded-md border border-rim-accent/30 bg-rim-void px-3 py-2 text-xs"
              >
                <p
                  className={`min-w-0 flex-1 ${savedQuery.isError ? "text-rim-danger" : "text-rim-text-muted"}`}
                >
                  {savedQuery.isError
                    ? `The saved command could not be loaded: ${graphqlErrorMessage(savedQuery.error, "unknown error")}`
                    : "Loading the saved steps..."}
                </p>
                <button
                  onClick={() => setEditingCommandId(null)}
                  className="shrink-0 rounded px-2 py-1 text-rim-text-muted hover:text-rim-text"
                >
                  Cancel
                </button>
              </div>
            );
          }

          const stepCount = stepCounts.get(cmd.id);
          return (
            <div
              key={cmd.id}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-rim-text"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{cmd.title}</div>
                <div className="truncate font-mono text-[10px] text-rim-text-muted">
                  {cmd.id}
                  {stepCount !== undefined && (
                    <span className="font-sans">
                      {" "}
                      · {stepCount} {stepCount === 1 ? "step" : "steps"}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => startEditingCommand(cmd.id)}
                className="shrink-0 text-rim-text-muted hover:text-rim-text"
                title="Edit"
                aria-label="Edit command"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => handleDelete(cmd.id)}
                className="shrink-0 text-rim-text-muted hover:text-rim-danger"
                title="Delete"
                aria-label="Delete command"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
