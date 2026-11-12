import { useCallback, useState } from "react";
import { Pencil, Play, Plus, Trash2, Wand2 } from "lucide-react";

import { errorSentence } from "../../../core/graphql/errors";
import { cn } from "../../../shared/ui/cn";
import { agentAvailable } from "../../agent/agentAvailability";
import { showInvisibleCharacters } from "../../agents/runtime/invisibleCharacters";
import {
  useDeleteUserCommandMutation,
  useUpdateUserCommandMutation,
} from "../../commands/api/useUserCommands";
import { LimitNote } from "../../limits/components/LimitNote";
import { limitView } from "../../limits/limits";
import { useAccountMacros, type AccountMacro } from "../api/useAccountMacros";
import { useMacroRegistry } from "../api/useMacroCommands";
import { useStepCommandChoices } from "../api/useStepCommandChoices";
import { stepTitle } from "../runtime/macroCommands";
import { MAX_MACROS } from "../runtime/macroSteps";
import { runCommandFromClick } from "../../commands/runtime/runFromClick";
import { deleteStayedMacro, retryWorkspaceMove, useStayedMacros } from "../runtime/macroMove";
import type { StayedMacro } from "../runtime/macroMoves";
import { useAuthStore } from "../../auth/state/useAuthStore";
import type { GeneratedMacro } from "../runtime/useMacroAgent";
import { AiMacroBuilder } from "./AiMacroBuilder";
import { MacroEditor, type MacroPrefill } from "./MacroEditor";

/** The longest list of step titles a macro's row shows before it says how many more. */
const SHOWN_STEP_TITLES = 4;

/**
 * Settings → Macros: the person's macros, their own commands made of other commands. Each one
 * is listed with its steps, turned on or off, run, edited or deleted, and new ones are made
 * here, by hand or with the AI agent.
 */
export function MacroSettings() {
  const { data: macros, isLoading, isError, error } = useAccountMacros();
  const choices = useStepCommandChoices();
  const registry = useMacroRegistry();
  const updateMutation = useUpdateUserCommandMutation();
  const deleteMutation = useDeleteUserCommandMutation();
  const aiAvailable = agentAvailable();

  const [editing, setEditing] = useState<AccountMacro | "new" | null>(null);
  const [prefill, setPrefill] = useState<MacroPrefill | undefined>(undefined);
  const [aiBuilderOpen, setAiBuilderOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const count = macros?.length ?? 0;
  const limit = limitView(MAX_MACROS, macros ? count : undefined, ["macro", "macros"], "macros");
  const full = count >= MAX_MACROS;

  const handleGenerated = useCallback((generated: GeneratedMacro) => {
    setPrefill({
      title: generated.name,
      description: generated.description,
      steps: generated.steps.map((step) => ({ commandId: step.commandId, args: step.args })),
    });
    setEditing("new");
  }, []);

  /** Runs `app.run_macro` on the macro, as the palette's Run Macro… does. */
  function run(macro: AccountMacro) {
    void runCommandFromClick("app.run_macro", { macro_id: macro.id });
  }

  function toggle(macro: AccountMacro) {
    updateMutation.mutate({
      commandId: macro.id,
      title: macro.title,
      description: macro.description,
      steps: macro.steps.map((step) => ({
        commandId: step.commandId,
        ...(step.args != null ? { args: step.args as Record<string, unknown> } : {}),
        ask: step.ask,
      })),
      isEnabled: !macro.isEnabled,
    });
  }

  function remove(macroId: string) {
    deleteMutation.mutate({ commandId: macroId }, { onSuccess: () => setConfirmDeleteId(null) });
  }

  function stepSummary(macro: AccountMacro): string {
    const titles = macro.steps.map((step) =>
      registry ? stepTitle(step.commandId, registry) : step.commandId,
    );
    const shown = titles.slice(0, SHOWN_STEP_TITLES).join(" → ");
    const more = titles.length - SHOWN_STEP_TITLES;
    const count = `${titles.length} ${titles.length === 1 ? "step" : "steps"}`;
    return `${count}: ${shown}${more > 0 ? ` and ${more} more` : ""}`;
  }

  if (editing !== null) {
    const isNew = editing === "new";
    const done = () => {
      setEditing(null);
      setPrefill(undefined);
    };
    return (
      <div>
        <h2 className="mb-4 text-base font-semibold text-rim-text">
          {isNew ? "New macro" : `Edit: ${showInvisibleCharacters(editing.title)}`}
        </h2>
        {choices.loaded ? (
          <MacroEditor
            initial={isNew ? undefined : editing}
            prefill={isNew ? prefill : undefined}
            macros={macros ?? []}
            choices={choices}
            onDone={done}
          />
        ) : (
          <p className="text-sm text-rim-text-muted">Loading commands...</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-rim-text">Macros</h2>
        <div className="flex items-center gap-2">
          {aiAvailable && (
            <button
              type="button"
              onClick={() => setAiBuilderOpen(true)}
              disabled={full}
              className="flex items-center gap-1 rounded-lg border border-rim-line px-3 py-1.5 text-sm font-medium text-rim-text-muted transition hover:bg-rim-void/50 hover:text-rim-text disabled:opacity-50"
            >
              <Wand2 className="h-4 w-4" /> Build with AI
            </button>
          )}
          <button
            type="button"
            onClick={() => setEditing("new")}
            disabled={full}
            className="flex items-center gap-1 rounded-lg bg-rim-text px-3 py-1.5 text-sm font-medium text-rim-panel transition hover:bg-rim-text/90 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> New macro
          </button>
        </div>
      </div>

      <p className="text-sm text-rim-text-muted">
        A macro is your own command, made of commands that run one after another. It works in every
        workspace: run it from the command palette, a key, a Home quick box or by typing / in the
        message box.
      </p>

      <LimitNote limit={limit} />

      {aiAvailable && (
        <AiMacroBuilder
          open={aiBuilderOpen}
          onClose={() => setAiBuilderOpen(false)}
          onStepsGenerated={handleGenerated}
          commands={choices.offered}
        />
      )}

      {isLoading && <p className="text-sm text-rim-text-muted">Loading macros...</p>}
      {isError && (
        <p role="alert" className="text-sm text-rim-danger">
          {errorSentence(error, "Your macros could not be loaded.")}
        </p>
      )}
      {(updateMutation.isError || deleteMutation.isError) && (
        <p role="alert" className="text-sm text-rim-danger">
          {errorSentence(
            updateMutation.error ?? deleteMutation.error,
            "The macro could not be changed.",
          )}
        </p>
      )}

      {macros && macros.length === 0 && (
        <p className="text-sm text-rim-text-muted">
          No macros yet. Make one to run several commands with one action.
        </p>
      )}

      {macros && macros.length > 0 && (
        <ul className="divide-y divide-rim-line rounded-lg border border-rim-line">
          {macros.map((macro) => {
            const title = showInvisibleCharacters(macro.title);
            return (
              <li key={macro.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      "text-sm font-medium",
                      macro.isEnabled ? "text-rim-text" : "text-rim-text-muted",
                    )}
                  >
                    {title}
                    {!macro.isEnabled && (
                      <span className="ml-2 text-xs font-normal text-rim-text-faint">Off</span>
                    )}
                  </div>
                  {macro.description && (
                    <div className="truncate text-xs text-rim-text-muted">
                      {showInvisibleCharacters(macro.description)}
                    </div>
                  )}
                  <div className="truncate text-xs text-rim-text-faint">
                    {showInvisibleCharacters(stepSummary(macro))}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={macro.isEnabled}
                    aria-label={`${title} is ${macro.isEnabled ? "on" : "off"}`}
                    onClick={() => toggle(macro)}
                    disabled={updateMutation.isPending}
                    className={cn(
                      "relative h-5 w-9 rounded-full transition disabled:opacity-50",
                      macro.isEnabled ? "bg-rim-accent" : "bg-rim-line",
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-0.5 h-4 w-4 rounded-full bg-rim-panel transition",
                        macro.isEnabled ? "left-4" : "left-0.5",
                      )}
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => run(macro)}
                    disabled={!macro.isEnabled}
                    title="Run macro"
                    aria-label={`Run ${title}`}
                    className="rounded-md p-1.5 text-rim-text-muted transition hover:bg-rim-accent/10 hover:text-rim-accent disabled:opacity-50"
                  >
                    <Play className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(macro)}
                    title="Edit macro"
                    aria-label={`Edit ${title}`}
                    className="rounded-md p-1.5 text-rim-text-muted transition hover:bg-rim-void/50 hover:text-rim-text"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  {confirmDeleteId === macro.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => remove(macro.id)}
                        className="rounded-md px-2 py-1 text-xs font-medium text-rim-danger transition hover:bg-rim-danger/10"
                      >
                        Delete
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
                      aria-label={`Delete ${title}`}
                      className="rounded-md p-1.5 text-rim-text-muted transition hover:bg-rim-danger/10 hover:text-rim-danger"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <NotMovedYet />
    </div>
  );
}

/**
 * The workspace macros that stayed in their workspace when the person's macros moved: each with
 * its workspace and why it stayed, to move again or delete. Nothing when none stayed.
 */
function NotMovedYet() {
  const userId = useAuthStore((s) => s.session?.userId);
  const stayed = useStayedMacros();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  if (!userId || stayed.length === 0) return null;

  async function tryAgain(entry: StayedMacro) {
    if (!userId) return;
    setProblem(null);
    setBusyId(entry.macroId);
    try {
      await retryWorkspaceMove(userId, { id: entry.workspaceId, name: entry.workspaceName });
    } finally {
      setBusyId(null);
    }
  }

  async function remove(entry: StayedMacro) {
    if (!userId) return;
    setProblem(null);
    setBusyId(entry.macroId);
    try {
      await deleteStayedMacro(userId, entry);
      setConfirmId(null);
    } catch (err) {
      setProblem(errorSentence(err, "The workspace macro could not be deleted."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section aria-labelledby="not-moved-yet" className="space-y-2">
      <h3 id="not-moved-yet" className="text-sm font-semibold text-rim-text">
        Not moved yet
      </h3>
      <p className="text-xs text-rim-text-muted">
        These macros from your workspaces could not become your macros. They are still kept in their
        workspace and run only there.
      </p>
      {problem && (
        <p role="alert" className="text-xs text-rim-danger">
          {problem}
        </p>
      )}
      <ul className="divide-y divide-rim-line rounded-lg border border-rim-line">
        {stayed.map((entry) => {
          const title = showInvisibleCharacters(entry.title);
          return (
            <li key={entry.macroId} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-rim-text">{title}</div>
                <div className="truncate text-xs text-rim-text-muted">
                  In {showInvisibleCharacters(entry.workspaceName)}: {entry.reason}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void tryAgain(entry)}
                  disabled={busyId !== null}
                  aria-label={`Try moving ${title} again`}
                  className="rounded-md px-2 py-1 text-xs text-rim-text-muted transition hover:bg-rim-void/50 hover:text-rim-text disabled:opacity-50"
                >
                  Try again
                </button>
                {confirmId === entry.macroId ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void remove(entry)}
                      disabled={busyId !== null}
                      className="rounded-md px-2 py-1 text-xs font-medium text-rim-danger transition hover:bg-rim-danger/10 disabled:opacity-50"
                    >
                      Delete it
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmId(null)}
                      className="rounded-md px-2 py-1 text-xs text-rim-text-muted transition hover:bg-rim-void/50"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmId(entry.macroId)}
                    disabled={busyId !== null}
                    aria-label={`Delete ${title} from ${showInvisibleCharacters(entry.workspaceName)}`}
                    className="rounded-md px-2 py-1 text-xs text-rim-text-muted transition hover:bg-rim-danger/10 hover:text-rim-danger disabled:opacity-50"
                  >
                    Delete
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
