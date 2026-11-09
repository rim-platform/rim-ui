import { CommandArgumentType } from "../../../core/graphql/generated/schema-types";
import { argumentPromptName } from "../../commands/runtime/commandDispatcher";
import {
  contextSuppliesArgument,
  formAsksFor,
  type ArgumentContext,
} from "../../commands/runtime/commandArguments";
import {
  isEmptyField,
  presetArgsOf,
  presetFields,
  readFields,
  toFieldValue,
  type FieldValues,
} from "../../commands/runtime/argumentValues";
import type { CommandArgumentInfo, CommandDefinition } from "../../commands/types";
import { findPluginCommand } from "../../plugins/runtime/pluginCommandInfo";
import type { AccountMacroStep } from "../api/useAccountMacros";

/** The most steps a macro may have. */
export const MAX_MACRO_STEP_COUNT = 20;

/** The most macros a person may keep. */
export const MAX_MACROS = 100;

/**
 * The type of an argument a command does not declare, from its name: a conversation, a workspace
 * or a member for the names that hold one, else text.
 */
export function argumentTypeOfName(name: string): CommandArgumentType {
  switch (name) {
    case "conversation_id":
    case "conversationId":
      return CommandArgumentType.CONVERSATION_ID;
    case "workspace_id":
    case "workspaceId":
    case "server_id":
    case "serverId":
      return CommandArgumentType.WORKSPACE_ID;
    case "user_id":
    case "userId":
      return CommandArgumentType.USER_ID;
    default:
      return CommandArgumentType.STRING;
  }
}

function pluginArgumentType(type: string | undefined): CommandArgumentType {
  switch (type) {
    case "integer":
      return CommandArgumentType.INTEGER;
    case "number":
      return CommandArgumentType.FLOAT;
    case "boolean":
      return CommandArgumentType.BOOLEAN;
    default:
      return CommandArgumentType.STRING;
  }
}

/**
 * The arguments a step running `command` can fix or ask for, as fields: a plugin command's from
 * its manifest; a built-in's or an app command's those the argument form has a field for,
 * required ones first, and the argument this app asks for with a picker when the step runs
 * without it. A workspace argument is left out: it is the workspace the macro runs in.
 */
export function stepFields(command: CommandDefinition | undefined): CommandArgumentInfo[] {
  if (!command) return [];
  if (command.sourceKind === "PLUGIN") {
    return (findPluginCommand(command.id)?.arguments ?? []).map((argument) => ({
      name: argument.name,
      argumentType: pluginArgumentType(argument.type),
      required: argument.required ?? false,
      ...(argument.description ? { description: argument.description } : {}),
    }));
  }
  const fields = presetFields(command);
  const prompted = argumentPromptName(command.id);
  if (prompted && !fields.some((field) => field.name === prompted)) {
    const argumentType = argumentTypeOfName(prompted);
    if (argumentType !== CommandArgumentType.WORKSPACE_ID) {
      fields.push({ name: prompted, argumentType, required: false });
    }
  }
  return fields;
}

/** A context with every part a macro may find where it runs: a workspace, a conversation, a message. */
const EVERY_CONTEXT: ArgumentContext = {
  workspaceId: "workspace",
  conversationId: "conversation",
  selectedMessageId: "message",
};

/**
 * The fields of a step that must be fixed or asked for: required, with a field, and neither
 * taken from where the macro runs nor asked by this app with a picker.
 */
export function requiredStepFields(command: CommandDefinition | undefined): CommandArgumentInfo[] {
  if (!command) return [];
  const prompted = argumentPromptName(command.id);
  return stepFields(command).filter(
    (field) =>
      field.required &&
      field.name !== prompted &&
      formAsksFor(field) &&
      !contextSuppliesArgument(field, EVERY_CONTEXT),
  );
}

/** One step of a macro being edited. */
export interface StepDraft {
  /** The command the step runs; empty until one is picked. */
  commandId: string;
  /** What the field of each argument holds, or `null` when the saved arguments do not fit them. */
  values: FieldValues | null;
  /** The saved arguments, kept as they are while `values` is `null`. */
  kept: Record<string, unknown>;
  /** The arguments asked for when the macro runs. */
  ask: string[];
}

function argsOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function emptyValues(fields: readonly CommandArgumentInfo[]): FieldValues {
  return Object.fromEntries(
    fields.map((field) => [
      field.name,
      field.argumentType === CommandArgumentType.BOOLEAN ? false : "",
    ]),
  );
}

/** A new step running `commandId`, with nothing fixed and nothing asked. */
export function newStepDraft(commandId: string, command: CommandDefinition | undefined): StepDraft {
  return { commandId, values: emptyValues(stepFields(command)), kept: {}, ask: [] };
}

/**
 * A saved step as the edit form shows it: each fixed argument in its field, or the saved
 * arguments kept as they are when a field cannot show one. A saved workspace argument is kept.
 *
 * @param step - The step as the home server keeps it, or as Build with AI made it.
 * @param command - The command it runs, when known here.
 */
export function stepDraftOf(
  step: Pick<AccountMacroStep, "commandId" | "args"> & { ask?: readonly string[] },
  command: CommandDefinition | undefined,
): StepDraft {
  const args = argsOf(step.args);
  const ask = [...(step.ask ?? [])];
  if (!command) return { commandId: step.commandId, values: null, kept: args, ask };
  const fields = stepFields(command);
  const values = emptyValues(fields);
  const kept: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(args)) {
    const field = fields.find((candidate) => candidate.name === name);
    if (!field) {
      if (argumentTypeOfName(name) === CommandArgumentType.WORKSPACE_ID) {
        kept[name] = value;
        continue;
      }
      return { commandId: step.commandId, values: null, kept: args, ask };
    }
    const shown = toFieldValue(field, value);
    if (shown === null) return { commandId: step.commandId, values: null, kept: args, ask };
    values[name] = shown;
  }
  return { commandId: step.commandId, values, kept, ask };
}

/** A step as `createUserCommand` and `updateUserCommand` take it. */
export interface StepInput {
  commandId: string;
  args?: Record<string, unknown>;
  ask: string[];
}

/** How reading a step for saving ended: its input, or what keeps it from being saved. */
export type ReadStep =
  { ok: true; input: StepInput } | { ok: false; problems: Record<string, string> };

/**
 * Reads a step for saving: its fixed arguments from the fields not asked for, and the names it
 * asks for. A required argument that is neither fixed nor asked for, or a field that cannot be
 * sent, keeps it from saving.
 *
 * @param draft - The step as edited.
 * @param command - The command it runs, when known here.
 * @param workspaceId - The workspace whose members and conversations its fields offered.
 */
export function readStep(
  draft: StepDraft,
  command: CommandDefinition | undefined,
  workspaceId: string | undefined,
): ReadStep {
  const ask = draft.ask;
  if (draft.values === null || !command) {
    const kept = Object.fromEntries(
      Object.entries(draft.kept).filter(([name]) => !ask.includes(name)),
    );
    return {
      ok: true,
      input: {
        commandId: draft.commandId,
        ...(Object.keys(kept).length > 0 ? { args: kept } : {}),
        ask,
      },
    };
  }
  const values = draft.values;
  const fields = stepFields(command).filter((field) => !ask.includes(field.name));
  const read = readFields(fields, values, false);
  const problems: Record<string, string> = read.ok ? {} : { ...read.problems };
  for (const field of requiredStepFields(command)) {
    if (ask.includes(field.name) || problems[field.name]) continue;
    if (isEmptyField(values[field.name])) {
      problems[field.name] =
        `${field.title || field.name} needs a value, or ask for it when the macro runs`;
    }
  }
  if (!read.ok || Object.keys(problems).length > 0) return { ok: false, problems };
  const fixed =
    command.sourceKind === "PLUGIN"
      ? read.args
      : (presetArgsOf(command, read.args, workspaceId) ?? {});
  const args = { ...draft.kept, ...fixed };
  return {
    ok: true,
    input: {
      commandId: draft.commandId,
      ...(Object.keys(args).length > 0 ? { args } : {}),
      ask,
    },
  };
}
