import { CommandArgumentType } from "../../../core/graphql/generated/schema-types";
import type { CommandArgumentInfo, CommandDefinition } from "../types";
import { camelCaseName, formAsksFor } from "./commandArguments";

/** What an argument field holds: a checkbox's state, or the text of any other field. */
export type FieldValue = string | boolean;

/** The values of a form's fields, by argument name. */
export type FieldValues = Record<string, FieldValue>;

/**
 * A server value shown as a label: words split on `_` and `-`, the first letter capitalised.
 *
 * @param value - An allowed value of an enum argument, such as `all` or `mentions_only`.
 * @returns The label, such as "All" or "Mentions only".
 */
export function humanizeValue(value: string): string {
  const words = value.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : value;
}

/** Whether `argument` is answered by picking one of a fixed set of values. */
export function hasChoices(argument: CommandArgumentInfo): boolean {
  return (
    (argument.argumentType === CommandArgumentType.ENUM ||
      argument.argumentType === CommandArgumentType.STRING) &&
    (argument.allowedValues?.length ?? 0) > 0
  );
}

/**
 * The value a field of the argument form starts with: the argument's default, else an unchecked
 * box or no text.
 */
export function defaultFieldValue(argument: CommandArgumentInfo): FieldValue {
  const shown = toFieldValue(argument, argument.defaultValue);
  if (shown !== null) return shown;
  return argument.argumentType === CommandArgumentType.BOOLEAN ? false : "";
}

/**
 * The field value that shows `value` as a field of `argument` can, or `null` when it cannot:
 * a number for a text field, a string outside an enum's values, an object.
 */
export function toFieldValue(argument: CommandArgumentInfo, value: unknown): FieldValue | null {
  if (value === undefined || value === null) return null;
  switch (argument.argumentType) {
    case CommandArgumentType.BOOLEAN:
      return typeof value === "boolean" ? value : null;
    case CommandArgumentType.INTEGER:
      return typeof value === "number" && Number.isInteger(value) ? String(value) : null;
    case CommandArgumentType.FLOAT:
      return typeof value === "number" && Number.isFinite(value) ? String(value) : null;
    default:
      if (typeof value !== "string") return null;
      if (hasChoices(argument) && value !== "" && !argument.allowedValues?.includes(value)) {
        return null;
      }
      return value;
  }
}

/** Whether a field holds nothing, so its argument is left out. */
export function isEmptyField(value: FieldValue | undefined): boolean {
  return value === undefined || value === "";
}

/**
 * Why a field's value cannot be sent, or `null` when it can.
 *
 * @param argument - The argument the field is for.
 * @param value - What the field holds.
 * @param mustFill - Whether the field must not be left empty.
 */
export function fieldProblem(
  argument: CommandArgumentInfo,
  value: FieldValue | undefined,
  mustFill: boolean,
): string | null {
  if (isEmptyField(value))
    return mustFill ? `${argument.title || argument.name} is required` : null;
  if (typeof value === "boolean") return null;
  const text = (value ?? "").trim();
  switch (argument.argumentType) {
    case CommandArgumentType.INTEGER:
      return /^-?\d+$/.test(text) ? null : "Enter a whole number";
    case CommandArgumentType.FLOAT:
      return text !== "" && Number.isFinite(Number(text)) ? null : "Enter a number";
    default:
      if (hasChoices(argument) && !argument.allowedValues?.includes(text)) {
        return "Choose one of the options";
      }
      return mustFill && text === "" ? `${argument.title || argument.name} is required` : null;
  }
}

/**
 * The argument value a field sends, or `undefined` when it sends none: a number for a number
 * field, `true` or `false` for a checkbox, the text for any other.
 */
export function argumentValueOf(
  argument: CommandArgumentInfo,
  value: FieldValue | undefined,
): unknown {
  if (isEmptyField(value)) return undefined;
  if (typeof value === "boolean") return value;
  const text = (value ?? "").trim();
  switch (argument.argumentType) {
    case CommandArgumentType.INTEGER:
      return Number.parseInt(text, 10);
    case CommandArgumentType.FLOAT:
      return Number(text);
    case CommandArgumentType.BOOLEAN:
      return text === "true";
    default:
      return argument.argumentType === CommandArgumentType.STRING ? (value as string) : text;
  }
}

/** The arguments a form's fields send, or the problem of each field that cannot be sent. */
export type ReadFields =
  { ok: true; args: Record<string, unknown> } | { ok: false; problems: Record<string, string> };

/**
 * Reads a form's fields into arguments.
 *
 * @param fields - The arguments the form shows.
 * @param values - What each field holds.
 * @param mustFill - Whether the form's required fields must be filled in; a preset form leaves
 *   an empty one to be asked for when the command runs.
 */
export function readFields(
  fields: readonly CommandArgumentInfo[],
  values: FieldValues,
  mustFill: boolean,
): ReadFields {
  const args: Record<string, unknown> = {};
  const problems: Record<string, string> = {};
  for (const field of fields) {
    const problem = fieldProblem(field, values[field.name], mustFill && field.required);
    if (problem) {
      problems[field.name] = problem;
      continue;
    }
    const value = argumentValueOf(field, values[field.name]);
    if (value !== undefined) args[field.name] = value;
  }
  return Object.keys(problems).length > 0 ? { ok: false, problems } : { ok: true, args };
}

/** Required arguments first, then optional ones, each group in the server's order. */
export function requiredFirst(fields: readonly CommandArgumentInfo[]): CommandArgumentInfo[] {
  return [...fields.filter((f) => f.required), ...fields.filter((f) => !f.required)];
}

/**
 * The arguments a keybind or quick action may save for `command`: those the argument form has a
 * field for, required ones first. A workspace argument is left out: it follows the member or
 * conversation picked, else the workspace open when the command runs.
 */
export function presetFields(command: Pick<CommandDefinition, "arguments">): CommandArgumentInfo[] {
  return requiredFirst(
    (command.arguments ?? []).filter(
      (argument) =>
        formAsksFor(argument) && argument.argumentType !== CommandArgumentType.WORKSPACE_ID,
    ),
  );
}

/** The workspace arguments of `command`, which a saved member or conversation pins. */
function workspaceArguments(command: Pick<CommandDefinition, "arguments">): CommandArgumentInfo[] {
  return (command.arguments ?? []).filter(
    (argument) => argument.argumentType === CommandArgumentType.WORKSPACE_ID,
  );
}

/**
 * The field values that show saved preset arguments, or `null` when they do not fit the fields:
 * a key the command declares no field for, or a value its field cannot show. A saved workspace
 * argument fits; it is kept, not shown.
 *
 * @param command - The command the arguments are saved for.
 * @param presetArgs - The saved arguments, when there are any.
 */
export function presetFieldValues(
  command: Pick<CommandDefinition, "arguments">,
  presetArgs: unknown,
): FieldValues | null {
  const fields = presetFields(command);
  const values: FieldValues = Object.fromEntries(fields.map((f) => [f.name, ""]));
  if (presetArgs === undefined || presetArgs === null) return values;
  if (typeof presetArgs !== "object" || Array.isArray(presetArgs)) return null;
  const workspaceNames = new Set(workspaceArguments(command).map((a) => a.name));
  for (const [key, value] of Object.entries(presetArgs as Record<string, unknown>)) {
    if (workspaceNames.has(key) && typeof value === "string") continue;
    const field = fields.find((f) => f.name === key);
    const shown = field ? toFieldValue(field, value) : null;
    if (shown === null) return null;
    values[key] = shown;
  }
  return values;
}

/** The workspace saved preset arguments pin, when they name one. */
export function presetWorkspace(
  command: Pick<CommandDefinition, "arguments">,
  presetArgs: unknown,
): string | undefined {
  if (typeof presetArgs !== "object" || presetArgs === null) return undefined;
  const record = presetArgs as Record<string, unknown>;
  for (const argument of workspaceArguments(command)) {
    const value = record[argument.name] ?? record[camelCaseName(argument.name)];
    if (typeof value === "string" && value !== "") return value;
  }
  return undefined;
}

/**
 * The preset arguments a keybind or quick action saves from its fields: the filled ones, and,
 * when a member or conversation is among them, the workspace they are in.
 *
 * @param command - The command the arguments are saved for.
 * @param args - The arguments the fields send, as `readFields` returns them.
 * @param workspaceId - The workspace whose members and conversations the fields offered.
 * @returns The arguments, or `undefined` when none are filled in.
 */
export function presetArgsOf(
  command: Pick<CommandDefinition, "arguments">,
  args: Record<string, unknown>,
  workspaceId: string | undefined,
): Record<string, unknown> | undefined {
  if (Object.keys(args).length === 0) return undefined;
  const pinsWorkspace = presetFields(command).some(
    (field) =>
      args[field.name] !== undefined &&
      (field.argumentType === CommandArgumentType.USER_ID ||
        field.argumentType === CommandArgumentType.CONVERSATION_ID),
  );
  if (!pinsWorkspace || !workspaceId) return args;
  const pinned = { ...args };
  for (const argument of workspaceArguments(command)) pinned[argument.name] = workspaceId;
  return pinned;
}
