import {
  CommandArgumentType,
  PipelineTriggerKindGql,
} from "../../core/graphql/generated/schema-types";
import { unfilledRequiredArguments } from "../commands/runtime/commandArguments";
import { takesPresetFields } from "../commands/runtime/commandRunnable";
import {
  fieldProblem,
  presetArgsOf,
  presetFields,
  readFields,
  toFieldValue,
  type FieldValues,
} from "../commands/runtime/argumentValues";
import { withEmptyLabel } from "../commands/components/argumentControlParts";
import type { CommandArgumentInfo, CommandDefinition } from "../commands/types";

/** The triggers whose event belongs to a conversation, which the server runs actions in. */
const CONVERSATION_TRIGGERS: ReadonlySet<PipelineTriggerKindGql> = new Set([
  PipelineTriggerKindGql.NEW_MESSAGE,
  PipelineTriggerKindGql.MESSAGE_UPDATED,
  PipelineTriggerKindGql.MESSAGE_DELETED,
  PipelineTriggerKindGql.REACTIONS_UPDATED,
]);

/** What a pipeline action's saved arguments and edits show in its form. */
export interface ActionForm {
  /** The fields to show, none when the command takes none. */
  fields: CommandArgumentInfo[];
  /** What each field holds: the saved value, unless it was edited. */
  values: FieldValues;
  /** Saved arguments the fields cannot show, or `undefined` when there are none. */
  extras: unknown;
  /** Saved workspace ids, kept and not shown. */
  pinned: Record<string, unknown>;
  /** Names of required fields the trigger's event does not supply. */
  mustFill: ReadonlySet<string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The form of a pipeline action. A pipeline runs with no person to ask, so a required field the
 * event cannot supply must be filled; the workspace is always supplied, the conversation by
 * the triggers that have one.
 *
 * @param command - The action's command, when the registry knows it and has loaded.
 * @param saved - The arguments saved with the action.
 * @param edited - The fields changed since.
 * @param removed - Whether the saved arguments the fields cannot show were removed.
 * @param trigger - The pipeline's trigger.
 */
export function actionForm(
  command: CommandDefinition | undefined,
  saved: unknown,
  edited: FieldValues,
  removed: boolean,
  trigger: PipelineTriggerKindGql,
): ActionForm {
  const fields = command && takesPresetFields(command) ? presetFields(command) : [];
  const supplies = {
    workspaceId: "workspace",
    ...(CONVERSATION_TRIGGERS.has(trigger) ? { conversationId: "conversation" } : {}),
  };
  const mustFill = new Set(
    command ? unfilledRequiredArguments(command, supplies).map((argument) => argument.name) : [],
  );
  const labelled = fields.map((field) =>
    withEmptyLabel(
      field,
      !field.required ? "Default" : mustFill.has(field.name) ? "Required" : "From the trigger",
    ),
  );
  const values: FieldValues = Object.fromEntries(fields.map((f) => [f.name, ""]));
  const pinned: Record<string, unknown> = {};
  let extras: unknown = undefined;
  if (isRecord(saved)) {
    const workspaceNames = new Set(
      (command?.arguments ?? [])
        .filter((a) => a.argumentType === CommandArgumentType.WORKSPACE_ID)
        .map((a) => a.name),
    );
    const rest: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(saved)) {
      const field = fields.find((f) => f.name === key);
      const shown = field ? toFieldValue(field, value, command?.id) : null;
      if (workspaceNames.has(key) && typeof value === "string") pinned[key] = value;
      else if (shown !== null) values[key] = shown;
      else rest[key] = value;
    }
    if (Object.keys(rest).length > 0) extras = rest;
  } else if (saved !== undefined && saved !== null) {
    extras = saved;
  }
  return {
    fields: labelled,
    values: { ...values, ...edited },
    extras: removed ? undefined : extras,
    pinned,
    mustFill,
  };
}

/** The arguments an action saves, or what keeps it from saving. */
export type ActionArgs =
  { ok: true; args: unknown } | { ok: false; problems: Record<string, string> };

/**
 * The arguments to save for a pipeline action: the form's values merged with the saved ones the
 * fields cannot show. Fails with the message of each required field the event cannot supply that
 * is empty, and of each value the field cannot send.
 *
 * @param command - The action's command, when known.
 * @param form - The action's form.
 * @param workspaceId - The pipeline's workspace.
 */
export function actionArgs(
  command: CommandDefinition | undefined,
  form: ActionForm,
  workspaceId: string,
): ActionArgs {
  const problems: Record<string, string> = {};
  const read = readFields(form.fields, form.values, false, command?.id);
  if (!read.ok) Object.assign(problems, read.problems);
  for (const field of form.fields) {
    if (!form.mustFill.has(field.name) || problems[field.name]) continue;
    const problem = fieldProblem(field, form.values[field.name], true, command?.id);
    if (problem) problems[field.name] = problem;
  }
  if (Object.keys(problems).length > 0 || !read.ok) return { ok: false, problems };
  const built = command ? (presetArgsOf(command, read.args, workspaceId) ?? {}) : {};
  if (form.extras !== undefined && !isRecord(form.extras)) {
    if (Object.keys(built).length > 0) {
      return {
        ok: false,
        problems: { "": "Remove the saved arguments the form can't show before filling fields." },
      };
    }
    return { ok: true, args: form.extras };
  }
  const merged = {
    ...form.pinned,
    ...(form.extras as Record<string, unknown> | undefined),
    ...built,
  };
  return { ok: true, args: Object.keys(merged).length > 0 ? merged : undefined };
}
