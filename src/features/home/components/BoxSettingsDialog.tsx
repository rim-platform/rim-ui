import { useId, useState, type ReactNode } from "react";
import { X } from "lucide-react";

import { Button } from "../../../shared/ui/Button";
import { Dialog } from "../../../shared/ui/Dialog";
import { showInvisibleCharacters } from "../../agents/runtime/invisibleCharacters";
import { useKeybindableCommands } from "../../commands/api/useKeybindableCommands";
import { PresetArgumentsSection } from "../../commands/components/ArgumentFields";
import {
  presetArgsOf,
  presetFields,
  presetFieldValues,
  presetWorkspace,
  readFields,
  type FieldValues,
} from "../../commands/runtime/argumentValues";
import { NEEDS_ARGUMENTS_NOTE, takesPresetFields } from "../../commands/runtime/commandRunnable";
import type { CommandDefinition } from "../../commands/types";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useChannels } from "../../conversations/api/useChannels";
import { useHomeWorkspaces } from "../api/useHomeWorkspaces";
import {
  BOX_COUNTS,
  DEFAULT_COUNT,
  EDIT_HOME_COMMAND,
  MAX_QUICK_ACTIONS,
  presetArgsProblem,
  readCount,
  type BoxCount,
  type QuickAction,
} from "../boxes/settings";

const INPUT_CLASS =
  "w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-rim-accent";

type Settings = Record<string, unknown>;

function asRecord(value: unknown): Settings {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Settings)
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 3, 5 or 10, as radio buttons. */
function CountChoice({
  legend,
  value,
  onChange,
}: {
  legend: string;
  value: BoxCount;
  onChange: (count: BoxCount) => void;
}) {
  const name = useId();
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-xs text-rim-text-muted">{legend}</legend>
      <div className="flex gap-2">
        {BOX_COUNTS.map((count) => (
          <label
            key={count}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-rim-line px-3 py-1.5 text-sm text-rim-text"
          >
            <input
              type="radio"
              name={name}
              value={count}
              checked={value === count}
              onChange={() => onChange(count)}
              className="accent-rim-accent"
            />
            {count}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** The buttons under a form: Cancel, and the one that saves it. */
function FormButtons({
  saveLabel,
  canSave,
  onCancel,
}: {
  saveLabel: string;
  canSave: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <Button type="button" variant="secondary" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" disabled={!canSave}>
        {saveLabel}
      </Button>
    </div>
  );
}

/** A workspace, then one of the channels the person can read there, and how many messages. */
function ChannelForm({
  initial,
  saveLabel,
  onSave,
  onCancel,
}: {
  initial: Settings;
  saveLabel: string;
  onSave: (settings: Settings) => void;
  onCancel: () => void;
}) {
  const { workspaces } = useHomeWorkspaces();
  const [workspaceId, setWorkspaceId] = useState(asString(initial.workspaceId));
  const [conversationId, setConversationId] = useState(asString(initial.conversationId));
  const [count, setCount] = useState<BoxCount>(readCount(initial.count) ?? DEFAULT_COUNT);
  const channels = useChannels(workspaceId || undefined);
  const options = (channels.data?.items ?? []).filter((channel) => !channel.isArchived);
  const workspaceField = useId();
  const channelField = useId();
  const chosen = options.some((channel) => channel.id === conversationId);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (workspaceId && chosen) onSave({ workspaceId, conversationId, count });
      }}
    >
      <div className="space-y-1">
        <label htmlFor={workspaceField} className="text-xs text-rim-text-muted">
          Workspace
        </label>
        <select
          id={workspaceField}
          value={workspaceId}
          onChange={(e) => {
            setWorkspaceId(e.target.value);
            setConversationId("");
          }}
          className={INPUT_CLASS}
        >
          <option value="">Choose a workspace</option>
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {showInvisibleCharacters(workspace.label)}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor={channelField} className="text-xs text-rim-text-muted">
          Channel
        </label>
        <select
          id={channelField}
          value={chosen ? conversationId : ""}
          disabled={!workspaceId}
          onChange={(e) => setConversationId(e.target.value)}
          className={INPUT_CLASS}
        >
          <option value="">
            {workspaceId && channels.isPending ? "Loading channels…" : "Choose a channel"}
          </option>
          {options.map((channel) => (
            <option key={channel.id} value={channel.id}>
              #{showInvisibleCharacters(channel.title ?? "channel")}
            </option>
          ))}
        </select>
        {conversationId && !chosen && !channels.isPending && (
          <p className="text-xs text-rim-warm">
            The channel this box showed isn&apos;t one you can read now. Choose another.
          </p>
        )}
      </div>
      <CountChoice legend="Messages shown" value={count} onChange={setCount} />
      <FormButtons
        saveLabel={saveLabel}
        canSave={Boolean(workspaceId && chosen)}
        onCancel={onCancel}
      />
    </form>
  );
}

/** How many direct conversations show. */
function DirectForm({
  initial,
  saveLabel,
  onSave,
  onCancel,
}: {
  initial: Settings;
  saveLabel: string;
  onSave: (settings: Settings) => void;
  onCancel: () => void;
}) {
  const [count, setCount] = useState<BoxCount>(readCount(initial.count) ?? DEFAULT_COUNT);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ count });
      }}
    >
      <CountChoice legend="Conversations shown" value={count} onChange={setCount} />
      <FormButtons saveLabel={saveLabel} canSave onCancel={onCancel} />
    </form>
  );
}

interface ActionDraft {
  commandId: string;
  /** The preset arguments as typed, JSON; empty for none. */
  args: string;
  /** The values of the argument fields once they are edited; until then they show `args`. */
  fields?: FieldValues;
}

function draftsOf(initial: Settings): ActionDraft[] {
  const actions = Array.isArray(initial.actions) ? initial.actions : [];
  const drafts = actions.slice(0, MAX_QUICK_ACTIONS).map((action) => {
    const record = asRecord(action);
    return {
      commandId: asString(record.commandId),
      args: record.presetArgs === undefined ? "" : JSON.stringify(record.presetArgs),
    };
  });
  return drafts.length > 0 ? drafts : [{ commandId: "", args: "" }];
}

/** The saved arguments a draft started from, or `null` when they are not JSON. */
function savedArgsOf(draft: ActionDraft): { value: unknown } | null {
  if (!draft.args.trim()) return { value: undefined };
  try {
    return { value: JSON.parse(draft.args) as unknown };
  } catch {
    return null;
  }
}

/**
 * The values of a draft's argument fields, or `null` when its arguments are typed as JSON: the
 * command has no fields, or the arguments saved with it do not fit them.
 */
function fieldValuesOf(command: CommandDefinition | undefined, draft: ActionDraft) {
  if (!command) return null;
  if (draft.fields) return draft.fields;
  const saved = savedArgsOf(draft);
  return saved ? presetFieldValues(command, saved.value) : null;
}

/** What a draft saves as, or why it cannot be saved, with the problem of each field. */
type ReadDraft =
  { problem: string; fieldProblems?: Record<string, string> } | { action: QuickAction };

/**
 * Why a typed action cannot be saved, or what it saves as.
 *
 * @param draft - The action as the form holds it.
 * @param command - The server command whose arguments it shows as fields, when it does.
 * @param fieldsWorkspace - The workspace whose members and conversations the fields offer.
 */
function readDraft(
  draft: ActionDraft,
  command: CommandDefinition | undefined,
  fieldsWorkspace: string | undefined,
): ReadDraft {
  if (!draft.commandId) return { problem: "Choose a command" };
  if (draft.commandId === EDIT_HOME_COMMAND) {
    return { problem: "Editing Home can't be a quick action" };
  }
  const values = fieldValuesOf(command, draft);
  if (command && values) {
    const read = readFields(presetFields(command), values, false);
    if (!read.ok) return { problem: "Check the arguments", fieldProblems: read.problems };
    const presetArgs = presetArgsOf(command, read.args, fieldsWorkspace);
    return {
      action: presetArgs
        ? { commandId: draft.commandId, presetArgs }
        : { commandId: draft.commandId },
    };
  }
  if (!draft.args.trim()) return { action: { commandId: draft.commandId } };
  let parsed: unknown;
  try {
    parsed = JSON.parse(draft.args);
  } catch {
    return { problem: "Arguments must be JSON, such as {}" };
  }
  const problem = presetArgsProblem(parsed);
  if (problem) return { problem };
  return {
    action: { commandId: draft.commandId, presetArgs: parsed as Record<string, unknown> },
  };
}

/** One to six actions, each a command a key could be bound to, with optional arguments. */
function QuickForm({
  initial,
  saveLabel,
  onSave,
  onCancel,
}: {
  initial: Settings;
  saveLabel: string;
  onSave: (settings: Settings) => void;
  onCancel: () => void;
}) {
  const { all, builtIn, unrunnable, needsArguments } = useKeybindableCommands();
  const openWorkspaceId = useWorkspaceStore((s) => s.workspaceId) ?? undefined;
  const commands = all.filter((command) => command.id !== EDIT_HOME_COMMAND);
  const [drafts, setDrafts] = useState<ActionDraft[]>(() => draftsOf(initial));
  const [tried, setTried] = useState(false);
  const baseId = useId();

  /** The server command whose arguments `draft` shows as fields, when it has fields. */
  function fieldsCommandOf(draft: ActionDraft): CommandDefinition | undefined {
    const command = builtIn.find((cmd) => cmd.id === draft.commandId);
    return command && takesPresetFields(command) ? command : undefined;
  }

  /** The workspace whose members and conversations `draft`'s fields offer. */
  function fieldsWorkspaceOf(draft: ActionDraft): string | undefined {
    const command = fieldsCommandOf(draft);
    const saved = savedArgsOf(draft);
    return (command && saved && presetWorkspace(command, saved.value)) || openWorkspaceId;
  }

  const read = drafts.map((draft) =>
    readDraft(draft, fieldsCommandOf(draft), fieldsWorkspaceOf(draft)),
  );

  function change(index: number, next: Partial<ActionDraft>) {
    setDrafts(drafts.map((draft, i) => (i === index ? { ...draft, ...next } : draft)));
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        const actions: QuickAction[] = [];
        for (const entry of read) {
          if ("problem" in entry) return;
          actions.push(entry.action);
        }
        onSave({ actions });
      }}
    >
      <ol className="space-y-3">
        {drafts.map((draft, index) => {
          const commandField = `${baseId}-command-${index}`;
          const argsField = `${baseId}-args-${index}`;
          const problemId = `${baseId}-problem-${index}`;
          const entry = read[index];
          const problem = tried && "problem" in entry ? entry.problem : null;
          const fieldsCommand = fieldsCommandOf(draft);
          const fieldValues = fieldValuesOf(fieldsCommand, draft);
          const fieldProblems =
            tried && "problem" in entry ? (entry.fieldProblems ?? {}) : undefined;
          const known = commands.some((command) => command.id === draft.commandId);
          const savedTitle = unrunnable.find((command) => command.id === draft.commandId)?.title;
          const presetArgs = "action" in entry ? entry.action.presetArgs : undefined;
          const unsupplied = needsArguments(draft.commandId, presetArgs);
          const noteId = `${baseId}-note-${index}`;
          return (
            <li key={index} className="space-y-1.5 rounded-lg border border-rim-line p-2.5">
              <div className="flex items-center gap-2">
                <label htmlFor={commandField} className="flex-1 text-xs text-rim-text-muted">
                  Action {index + 1}
                </label>
                {drafts.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Remove action ${index + 1}`}
                    onClick={() => setDrafts(drafts.filter((_, i) => i !== index))}
                    className="rounded p-1 text-rim-text-muted hover:text-rim-text"
                  >
                    <X aria-hidden className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <select
                id={commandField}
                value={draft.commandId}
                onChange={(e) => change(index, { commandId: e.target.value, fields: undefined })}
                aria-describedby={
                  [problem ? problemId : null, unsupplied ? noteId : null]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
                aria-invalid={problem ? true : undefined}
                className={INPUT_CLASS}
              >
                <option value="">Choose a command</option>
                {draft.commandId && !known && (
                  <option value={draft.commandId}>
                    {showInvisibleCharacters(savedTitle || draft.commandId)}
                  </option>
                )}
                {commands.map((command) => (
                  <option key={command.id} value={command.id}>
                    {showInvisibleCharacters(command.title || command.id)}
                  </option>
                ))}
              </select>
              {unsupplied && (
                <p id={noteId} className="text-xs text-rim-text-muted">
                  {NEEDS_ARGUMENTS_NOTE}
                </p>
              )}
              {fieldsCommand && fieldValues ? (
                <PresetArgumentsSection
                  fields={presetFields(fieldsCommand)}
                  values={fieldValues}
                  onChange={(name, value) =>
                    change(index, { fields: { ...fieldValues, [name]: value } })
                  }
                  problems={fieldProblems}
                  workspaceId={fieldsWorkspaceOf(draft)}
                  emptyNote="asked for when the action runs"
                />
              ) : (
                <>
                  <label htmlFor={argsField} className="block text-xs text-rim-text-muted">
                    Arguments (optional JSON)
                  </label>
                  <input
                    id={argsField}
                    value={draft.args}
                    placeholder="{}"
                    onChange={(e) => change(index, { args: e.target.value })}
                    aria-describedby={problem ? problemId : undefined}
                    className={INPUT_CLASS}
                  />
                </>
              )}
              {problem && (
                <p id={problemId} className="text-xs text-rim-danger">
                  {problem}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      {drafts.length < MAX_QUICK_ACTIONS && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setDrafts([...drafts, { commandId: "", args: "" }])}
        >
          Add an action
        </Button>
      )}
      <FormButtons saveLabel={saveLabel} canSave onCancel={onCancel} />
    </form>
  );
}

/**
 * The settings of one box, or of a box about to be added, in a dialog: Save keeps them, and
 * Cancel or Escape leaves everything as it was.
 *
 * @param kind - The kind whose settings these are: `channel`, `direct` or `quick`.
 * @param initial - The settings to start from; settings this app cannot read start blank.
 * @param adding - Whether saving adds a new box rather than changing one.
 */
export function BoxSettingsDialog({
  kind,
  title,
  initial,
  adding,
  onSave,
  onClose,
}: {
  kind: string;
  title: string;
  initial: unknown;
  adding: boolean;
  onSave: (settings: Settings) => void;
  onClose: () => void;
}) {
  const settings = asRecord(initial);
  const props = {
    initial: settings,
    saveLabel: adding ? "Add" : "Save",
    onSave,
    onCancel: onClose,
  };
  let form: ReactNode = null;
  if (kind === "channel") form = <ChannelForm {...props} />;
  else if (kind === "direct") form = <DirectForm {...props} />;
  else if (kind === "quick") form = <QuickForm {...props} />;
  return (
    <Dialog open title={title} onClose={onClose} maxWidth="max-w-md">
      {form}
    </Dialog>
  );
}
