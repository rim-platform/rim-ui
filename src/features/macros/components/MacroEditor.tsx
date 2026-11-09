import { useState } from "react";
import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";

import { errorSentence } from "../../../core/graphql/errors";
import { agentAvailable } from "../../agent/agentAvailability";
import { showInvisibleCharacters } from "../../agents/runtime/invisibleCharacters";
import { ArgumentField } from "../../commands/components/ArgumentFields";
import {
  useCreateUserCommandMutation,
  useUpdateUserCommandMutation,
} from "../../commands/api/useUserCommands";
import { argumentPromptName } from "../../commands/runtime/commandDispatcher";
import { isEmptyField, type FieldValue } from "../../commands/runtime/argumentValues";
import type { UserCommandStepInput } from "../../commands/types";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import type { AccountMacro } from "../api/useAccountMacros";
import type { StepCommandChoices } from "../api/useStepCommandChoices";
import {
  AGENT_OPTION_BLOCKER,
  agentOptionBlocker,
  isMacroId,
  macroKeyFromTitle,
} from "../runtime/macroCommands";
import {
  MAX_MACRO_STEP_COUNT,
  newStepDraft,
  readStep,
  stepDraftOf,
  stepFields,
  type StepDraft,
} from "../runtime/macroSteps";
import { StepCommandPicker } from "./StepCommandPicker";

/** The most characters a macro's title may have. */
const MAX_TITLE_LENGTH = 128;

/** The most example requests a macro may give the AI agent. */
const MAX_INTENT_SAMPLES = 10;

/** What a new macro starts with: from Build with AI, or nothing. */
export interface MacroPrefill {
  title: string;
  description: string;
  steps: { commandId: string; args?: unknown }[];
}

export interface MacroEditorProps {
  /** The macro being edited; a new macro when left out. */
  initial?: AccountMacro;
  prefill?: MacroPrefill;
  /** The person's macros, which a new title must differ from. */
  macros: readonly AccountMacro[];
  choices: StepCommandChoices;
  /** Called after a save and on Cancel. */
  onDone: () => void;
}

const inputClass =
  "w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none focus:border-rim-accent";

/**
 * The form that creates or edits one of the person's macros: its title, description and up to
 * 20 steps, each a command with every argument fixed or asked for when the macro runs, and
 * whether the AI agent may run it.
 */
export function MacroEditor({ initial, prefill, macros, choices, onDone }: MacroEditorProps) {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId) ?? undefined;
  const createMutation = useCreateUserCommandMutation();
  const updateMutation = useUpdateUserCommandMutation();
  const agentShown = agentAvailable();

  const [title, setTitle] = useState(initial?.title ?? prefill?.title ?? "");
  const [description, setDescription] = useState(
    initial?.description ?? prefill?.description ?? "",
  );
  const [steps, setSteps] = useState<StepDraft[]>(() => {
    const saved = initial?.steps ?? prefill?.steps ?? [];
    const drafts = saved.map((step) => stepDraftOf(step, choices.command(step.commandId)));
    return drafts.length > 0 ? drafts : [newStepDraft("", undefined)];
  });
  const [aiCallable, setAiCallable] = useState(initial?.aiCallable ?? false);
  const [nlDescription, setNlDescription] = useState(initial?.nlDescription ?? "");
  const [samples, setSamples] = useState((initial?.intentSamples ?? []).join("\n"));
  const [problems, setProblems] = useState<Record<number, Record<string, string>>>({});
  const [formProblem, setFormProblem] = useState<string | null>(null);

  const chosen = steps.filter((step) => step.commandId !== "");
  const blocker = agentOptionBlocker(chosen, choices.command);
  const mutation = initial ? updateMutation : createMutation;

  function changeStep(index: number, change: (step: StepDraft) => StepDraft) {
    setSteps((prev) => prev.map((step, i) => (i === index ? change(step) : step)));
    setProblems((prev) => ({ ...prev, [index]: {} }));
  }

  function moveStep(index: number, by: -1 | 1) {
    const target = index + by;
    if (target < 0 || target >= steps.length) return;
    setSteps((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setProblems({});
  }

  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index));
    setProblems({});
  }

  function save() {
    setFormProblem(null);
    const trimmed = title.trim();
    if (!trimmed) {
      setFormProblem("Give the macro a title.");
      return;
    }
    const lower = trimmed.toLowerCase();
    if (macros.some((m) => m.id !== initial?.id && m.title.trim().toLowerCase() === lower)) {
      setFormProblem(`You already have a macro called "${trimmed}".`);
      return;
    }
    if (chosen.length === 0) {
      setFormProblem("Choose a command for at least one step.");
      return;
    }
    const inputs: UserCommandStepInput[] = [];
    const found: Record<number, Record<string, string>> = {};
    steps.forEach((step, index) => {
      if (step.commandId === "") return;
      const read = readStep(step, choices.command(step.commandId), workspaceId);
      if (read.ok) inputs.push(read.input);
      else found[index] = read.problems;
    });
    if (Object.keys(found).length > 0) {
      setProblems(found);
      setFormProblem("Fix the steps marked in red before saving.");
      return;
    }
    const agentFields = agentShown
      ? {
          aiCallable: aiCallable && blocker === null,
          nlDescription: nlDescription.trim(),
          intentSamples: samples
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .slice(0, MAX_INTENT_SAMPLES),
        }
      : {};
    const common = {
      title: trimmed,
      description: description.trim(),
      steps: inputs,
      ...agentFields,
    };
    if (initial) {
      updateMutation.mutate(
        { ...common, commandId: initial.id, isEnabled: initial.isEnabled },
        { onSuccess: onDone },
      );
    } else {
      const key = macroKeyFromTitle(
        trimmed,
        macros.map((m) => m.id),
      );
      createMutation.mutate({ ...common, commandId: `user.${key}` }, { onSuccess: onDone });
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="macro-title" className="mb-1 block text-sm font-medium text-rim-text">
          Title
        </label>
        <input
          id="macro-title"
          type="text"
          value={title}
          maxLength={MAX_TITLE_LENGTH}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Morning catch-up"
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor="macro-description" className="mb-1 block text-sm font-medium text-rim-text">
          Description
        </label>
        <textarea
          id="macro-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What this macro does"
          rows={2}
          className={`${inputClass} resize-none`}
        />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-rim-text">
            Steps ({steps.length}/{MAX_MACRO_STEP_COUNT})
          </span>
          <button
            type="button"
            onClick={() => setSteps((prev) => [...prev, newStepDraft("", undefined)])}
            disabled={steps.length >= MAX_MACRO_STEP_COUNT}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-rim-accent transition hover:bg-rim-accent/10 disabled:opacity-40"
          >
            <Plus className="h-3 w-3" /> Add step
          </button>
        </div>
        <p className="mb-2 text-xs text-rim-text-faint">
          The steps run in order. A step that opens a form or a picker does not wait for it, so put
          it last.
        </p>
        <ol className="space-y-2">
          {steps.map((step, index) => (
            <StepRow
              key={index}
              index={index}
              step={step}
              last={index === steps.length - 1}
              count={steps.length}
              choices={choices}
              macros={macros}
              workspaceId={workspaceId}
              problems={problems[index] ?? {}}
              onChange={(change) => changeStep(index, change)}
              onMove={(by) => moveStep(index, by)}
              onRemove={() => removeStep(index)}
            />
          ))}
        </ol>
      </div>

      {agentShown && (
        <fieldset className="space-y-2 rounded-lg border border-rim-line p-3">
          <label className="flex items-center gap-2 text-sm text-rim-text">
            <input
              type="checkbox"
              checked={aiCallable && blocker === null}
              disabled={blocker !== null}
              onChange={(e) => setAiCallable(e.target.checked)}
            />
            The AI agent can run this
          </label>
          {blocker !== null ? (
            <p className="text-xs text-rim-text-muted" data-testid="agent-option-blocker">
              {AGENT_OPTION_BLOCKER}.
            </p>
          ) : (
            <p className="text-xs text-rim-text-faint">
              The agent runs it as one command, and asks you first when a step changes something.
            </p>
          )}
          {aiCallable && blocker === null && (
            <>
              <label className="block text-xs text-rim-text-muted">
                What it is for, in the agent&apos;s words (optional)
                <textarea
                  value={nlDescription}
                  onChange={(e) => setNlDescription(e.target.value)}
                  rows={2}
                  className={`${inputClass} mt-1 resize-none`}
                />
              </label>
              <label className="block text-xs text-rim-text-muted">
                Things you might ask for it, one per line (optional)
                <textarea
                  value={samples}
                  onChange={(e) => setSamples(e.target.value)}
                  rows={2}
                  className={`${inputClass} mt-1 resize-none`}
                />
              </label>
            </>
          )}
        </fieldset>
      )}

      {formProblem && (
        <p role="alert" className="text-xs text-rim-danger">
          {formProblem}
        </p>
      )}
      {mutation.isError && (
        <p role="alert" className="text-xs text-rim-danger">
          {errorSentence(mutation.error, "The macro could not be saved.")}
        </p>
      )}

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={save}
          disabled={mutation.isPending}
          className="rounded-lg bg-rim-text px-4 py-2 text-sm font-medium text-rim-panel transition hover:bg-rim-text/90 disabled:opacity-50"
        >
          {mutation.isPending ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg border border-rim-line px-4 py-2 text-sm text-rim-text-muted transition hover:bg-rim-void/50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

interface StepRowProps {
  index: number;
  step: StepDraft;
  last: boolean;
  count: number;
  choices: StepCommandChoices;
  macros: readonly AccountMacro[];
  workspaceId: string | undefined;
  problems: Record<string, string>;
  onChange: (change: (step: StepDraft) => StepDraft) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}

/** One step of the form: its command, a field per argument and whether each is asked for. */
function StepRow({
  index,
  step,
  last,
  count,
  choices,
  macros,
  workspaceId,
  problems,
  onChange,
  onMove,
  onRemove,
}: StepRowProps) {
  const command = choices.command(step.commandId);
  const fields = stepFields(command);
  const nested = isMacroId(step.commandId);
  const prompted = argumentPromptName(step.commandId);
  const opensPicker =
    prompted !== undefined && !step.ask.includes(prompted) && isEmptyField(step.values?.[prompted]);

  function setValue(name: string, value: FieldValue) {
    onChange((s) => (s.values ? { ...s, values: { ...s.values, [name]: value } } : s));
  }

  function setAsked(name: string, asked: boolean) {
    onChange((s) => ({
      ...s,
      ask: asked ? [...s.ask.filter((n) => n !== name), name] : s.ask.filter((n) => n !== name),
    }));
  }

  return (
    <li className="flex items-start gap-2 rounded-lg border border-rim-line bg-rim-void p-3">
      <span className="mt-1.5 text-xs font-mono text-rim-text-muted">{index + 1}.</span>
      <div className="min-w-0 flex-1 space-y-2">
        {nested ? (
          <p className="text-sm text-rim-text">
            {showInvisibleCharacters(
              macros.find((m) => m.id === step.commandId)?.title ?? step.commandId,
            )}{" "}
            <span className="text-xs text-rim-text-muted">
              Another macro (kept, no longer offered)
            </span>
          </p>
        ) : (
          <StepCommandPicker
            value={step.commandId}
            commands={choices.offered}
            label={`Step ${index + 1} command`}
            onChange={(commandId) =>
              onChange(() => newStepDraft(commandId, choices.command(commandId)))
            }
          />
        )}
        {!nested && step.commandId !== "" && !command && choices.loaded && (
          <p className="text-xs text-rim-warm">
            {step.commandId.startsWith("plugin.")
              ? "This step's plugin isn't installed on this device. The step is kept as it is."
              : "This command isn't offered here any more. The step is kept as it is."}
          </p>
        )}
        {command && step.values === null && (
          <p className="text-xs text-rim-text-muted">
            Saved with{" "}
            <code className="break-all font-mono text-rim-text">{JSON.stringify(step.kept)}</code>,
            kept as they are.
          </p>
        )}
        {command && step.values !== null && fields.length > 0 && (
          <div className="space-y-3">
            {fields.map((field) => {
              const asked = step.ask.includes(field.name);
              return (
                <div key={field.name} className="space-y-1">
                  {asked ? (
                    <p className="text-xs text-rim-text-muted">
                      {field.title || field.name}: asked when the macro runs
                    </p>
                  ) : (
                    <ArgumentField
                      argument={field}
                      value={step.values?.[field.name] ?? ""}
                      onChange={(value) => setValue(field.name, value)}
                      mode="preset"
                      problem={problems[field.name] ?? null}
                      workspaceId={workspaceId}
                      commandId={step.commandId}
                      formValues={step.values ?? undefined}
                    />
                  )}
                  <label className="flex items-center gap-1.5 text-xs text-rim-text-muted">
                    <input
                      type="checkbox"
                      checked={asked}
                      onChange={(e) => setAsked(field.name, e.target.checked)}
                      aria-label={`Ask for ${field.title || field.name} when I run it`}
                    />
                    Ask when I run it
                  </label>
                  {asked && problems[field.name] && (
                    <p className="text-xs text-rim-danger">{problems[field.name]}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {opensPicker && !last && (
          <p className="text-xs text-rim-warm">
            This step opens a picker and does not wait for it. Put it last.
          </p>
        )}
      </div>
      <div className="flex flex-col gap-0.5">
        <button
          type="button"
          onClick={() => onMove(-1)}
          disabled={index === 0}
          aria-label={`Move step ${index + 1} up`}
          className="rounded p-0.5 text-rim-text-muted transition hover:text-rim-text disabled:opacity-30"
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onMove(1)}
          disabled={index === count - 1}
          aria-label={`Move step ${index + 1} down`}
          className="rounded p-0.5 text-rim-text-muted transition hover:text-rim-text disabled:opacity-30"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onRemove}
          disabled={count <= 1}
          aria-label={`Remove step ${index + 1}`}
          className="rounded p-0.5 text-rim-text-muted transition hover:text-rim-danger disabled:opacity-30"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}
