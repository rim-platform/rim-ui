import { CommandArgumentType } from "../../../core/graphql/generated/schema-types";
import { stateKeyProblem } from "../../workspace-state/stateKeyRules";
import type { CommandArgumentInfo, CommandDefinition } from "../types";
import {
  argumentPicker,
  argumentPickerKind,
  CLEARED_FIELD,
  memberIdsOf,
  sendsEmptyText,
} from "./argumentPickers";
import { camelCaseName, formAsksFor } from "./commandArguments";
import { argumentPromptName } from "./commandDispatcher";
import { normalizeStateValue, stateValueProblem } from "./stateValueKinds";
import {
  isTimeFieldKind,
  timeField,
  timeFieldProblem,
  unusedTimeArguments,
  type TimeField,
} from "./timeChoices";

/**
 * What an argument field holds: a checkbox's state, or the text of any other field. A field
 * that can be cleared holds `true` while cleared.
 */
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

/**
 * The label of an argument's field: the one its picker gives, else its title, else its name as
 * words.
 */
export function argumentLabel(
  argument: Pick<CommandArgumentInfo, "name" | "title">,
  commandId?: string,
): string {
  return (
    argumentPicker(commandId, argument.name)?.label ||
    argument.title ||
    humanizeValue(argument.name)
  );
}

/** The text under an argument's field: the one its picker gives, else its description. */
export function argumentHint(
  argument: Pick<CommandArgumentInfo, "name" | "description">,
  commandId?: string,
): string {
  return argumentPicker(commandId, argument.name)?.hint ?? argument.description ?? "";
}

/** The time field of an argument, when its picker is one. */
export function timeFieldOf(commandId: string | undefined, argumentName: string): TimeField | null {
  const picker = argumentPicker(commandId, argumentName);
  return isTimeFieldKind(picker?.kind) ? timeField(picker.kind, picker.valueLabels) : null;
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
 *
 * @param argument - The argument the field is for.
 * @param value - The saved value.
 * @param commandId - The command the argument is of, whose picker may show the value its way.
 */
export function toFieldValue(
  argument: CommandArgumentInfo,
  value: unknown,
  commandId?: string,
): FieldValue | null {
  if (value === undefined || value === null) return null;
  const kind = argumentPicker(commandId, argument.name)?.kind;
  if (kind === "clearableText" && value === "") return CLEARED_FIELD;
  if (kind === "stateValue" && typeof value === "string") return normalizeStateValue(value);
  if (kind === "members") {
    if (Array.isArray(value)) {
      return value.every((id) => typeof id === "string")
        ? memberIdsOf(value.join(",")).join(",")
        : null;
    }
    return typeof value === "string" ? memberIdsOf(value).join(",") : null;
  }
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

/**
 * Arguments a command already has as field values, for fields that follow them, such as the
 * current value of a given state key. A value no field holds, such as an object, is left out.
 *
 * @param args - The arguments, by name.
 * @returns Their texts, numbers as text, and checkbox states, by name.
 */
export function givenFieldValues(args: Readonly<Record<string, unknown>>): FieldValues {
  return Object.fromEntries(
    Object.entries(args).flatMap(([name, value]): [string, FieldValue][] => {
      if (typeof value === "string" || typeof value === "boolean") return [[name, value]];
      if (typeof value === "number") return [[name, String(value)]];
      return [];
    }),
  );
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
 * @param commandId - The command the argument is of, whose picker may check the value too.
 */
export function fieldProblem(
  argument: CommandArgumentInfo,
  value: FieldValue | undefined,
  mustFill: boolean,
  commandId?: string,
): string | null {
  const label = argumentLabel(argument, commandId);
  if (isEmptyField(value)) return mustFill ? `${label} is required` : null;
  if (typeof value === "boolean") return null;
  const text = (value ?? "").trim();
  const picker = argumentPicker(commandId, argument.name);
  if (picker?.kind === "stateKey" && text !== "") {
    const problem = stateKeyProblem(text, { allowSystem: picker.keyAccess === "read" });
    if (problem) return problem;
  }
  if (picker?.kind === "stateValue") {
    const problem = stateValueProblem(value ?? "");
    if (problem) return problem;
  }
  switch (argument.argumentType) {
    case CommandArgumentType.INTEGER:
      return /^-?\d+$/.test(text) ? null : "Enter a whole number";
    case CommandArgumentType.FLOAT:
      return text !== "" && Number.isFinite(Number(text)) ? null : "Enter a number";
    default:
      if (hasChoices(argument) && !argument.allowedValues?.includes(text)) {
        return "Choose one of the options";
      }
      return mustFill && text === "" ? `${label} is required` : null;
  }
}

/**
 * The argument value a field sends, or `undefined` when it sends none: a number for a number
 * field, `true` or `false` for a checkbox, the text for any other, and `""` for a cleared field.
 *
 * @param argument - The argument the field is for.
 * @param value - What the field holds.
 * @param commandId - The command the argument is of, whose picker may send an empty string.
 */
export function argumentValueOf(
  argument: CommandArgumentInfo,
  value: FieldValue | undefined,
  commandId?: string,
): unknown {
  if (sendsEmptyText(commandId, argument.name)) {
    if (value === CLEARED_FIELD) return "";
    if (typeof value === "boolean") return undefined;
  }
  if (isEmptyField(value)) return undefined;
  if (typeof value === "boolean") return value;
  const text = (value ?? "").trim();
  const kind = argumentPickerKind(commandId, argument.name);
  if (kind === "stateKey") return text;
  if (kind === "members") {
    const ids = memberIdsOf(text);
    return ids.length > 0 ? ids.join(",") : undefined;
  }
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
 * Reads a form's fields into arguments. A time field is checked as a whole, its problem shown on
 * its own argument, and sends only the arguments its choice sets.
 *
 * @param fields - The arguments the form shows.
 * @param values - What each field holds.
 * @param mustFill - Whether the form's required fields must be filled in; a preset form leaves
 *   an empty one to be asked for when the command runs.
 * @param commandId - The command the fields are of, whose pickers may read some their way.
 */
export function readFields(
  fields: readonly CommandArgumentInfo[],
  values: FieldValues,
  mustFill: boolean,
  commandId?: string,
): ReadFields {
  const args: Record<string, unknown> = {};
  const problems: Record<string, string> = {};
  const timeFields = fields.flatMap((field) => {
    const time = timeFieldOf(commandId, field.name);
    return time ? [{ name: field.name, time }] : [];
  });
  for (const field of fields) {
    const time = timeFields.find((candidate) => candidate.name === field.name)?.time;
    const problem =
      (time ? timeFieldProblem(time, values) : null) ??
      fieldProblem(field, values[field.name], mustFill && field.required, commandId);
    if (problem) {
      problems[field.name] = problem;
      continue;
    }
    const value = argumentValueOf(field, values[field.name], commandId);
    if (value !== undefined) args[field.name] = value;
  }
  for (const { time } of timeFields) {
    for (const name of unusedTimeArguments(time, values)) delete args[name];
  }
  return Object.keys(problems).length > 0 ? { ok: false, problems } : { ok: true, args };
}

/** Required arguments first, then optional ones, each group in the server's order. */
export function requiredFirst(fields: readonly CommandArgumentInfo[]): CommandArgumentInfo[] {
  return [...fields.filter((f) => f.required), ...fields.filter((f) => !f.required)];
}

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

/**
 * The arguments a keybind, a quick action or a macro step may save for `command`: those the
 * argument form has a field for, required ones first, and the argument this app asks for with a
 * picker when the command runs without it. A workspace argument is left out: it follows the
 * member or conversation picked, else the workspace open when the command runs.
 */
export function presetFields(
  command: Pick<CommandDefinition, "arguments"> & Partial<Pick<CommandDefinition, "id">>,
): CommandArgumentInfo[] {
  const fields = requiredFirst(
    (command.arguments ?? []).filter(
      (argument) =>
        formAsksFor(argument) && argument.argumentType !== CommandArgumentType.WORKSPACE_ID,
    ),
  );
  const prompted = command.id === undefined ? undefined : argumentPromptName(command.id);
  if (prompted && !fields.some((field) => field.name === prompted)) {
    const argumentType = argumentTypeOfName(prompted);
    if (argumentType !== CommandArgumentType.WORKSPACE_ID) {
      fields.push({ name: prompted, argumentType, required: false });
    }
  }
  return fields;
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
  command: Pick<CommandDefinition, "arguments"> & Partial<Pick<CommandDefinition, "id">>,
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
    const shown = field ? toFieldValue(field, value, command.id) : null;
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
 * when a member, members or a conversation are among them, the workspace they are in.
 *
 * @param command - The command the arguments are saved for; its id names the fields that hold
 *   members as text.
 * @param args - The arguments the fields send, as `readFields` returns them.
 * @param workspaceId - The workspace whose members and conversations the fields offered.
 * @returns The arguments, or `undefined` when none are filled in.
 */
export function presetArgsOf(
  command: Pick<CommandDefinition, "arguments"> & Partial<Pick<CommandDefinition, "id">>,
  args: Record<string, unknown>,
  workspaceId: string | undefined,
): Record<string, unknown> | undefined {
  if (Object.keys(args).length === 0) return undefined;
  const pinsWorkspace = presetFields(command).some(
    (field) =>
      args[field.name] !== undefined &&
      (field.argumentType === CommandArgumentType.USER_ID ||
        field.argumentType === CommandArgumentType.CONVERSATION_ID ||
        argumentPickerKind(command.id, field.name) === "members"),
  );
  if (!pinsWorkspace || !workspaceId) return args;
  const pinned = { ...args };
  for (const argument of workspaceArguments(command)) pinned[argument.name] = workspaceId;
  return pinned;
}
