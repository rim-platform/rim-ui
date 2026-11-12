import { CommandArgumentType } from "../../../core/graphql/generated/schema-types";
import type { CommandArgumentInfo, CommandContextInput, CommandDefinition } from "../types";
import { runsOnServer } from "./serverRunnable";

/** The parts of a command's context the server fills arguments from. */
export type ArgumentContext = Pick<
  CommandContextInput,
  "workspaceId" | "conversationId" | "selectedMessageId"
>;

/**
 * Whether the server takes `argument` from `context` when the caller leaves it out: a
 * workspace argument from the context's workspace, a conversation argument from its
 * conversation, a message argument from its selected message.
 */
export function contextSuppliesArgument(
  argument: CommandArgumentInfo,
  context: ArgumentContext,
): boolean {
  switch (argument.argumentType) {
    case CommandArgumentType.WORKSPACE_ID:
      return Boolean(context.workspaceId);
    case CommandArgumentType.CONVERSATION_ID:
      return Boolean(context.conversationId);
    case CommandArgumentType.MESSAGE_ID:
      return Boolean(context.selectedMessageId);
    default:
      return false;
  }
}

/** The required arguments of `command` that `context` does not supply. */
export function unfilledRequiredArguments(
  command: Pick<CommandDefinition, "arguments">,
  context: ArgumentContext,
): CommandArgumentInfo[] {
  return (command.arguments ?? []).filter(
    (argument) => argument.required && !contextSuppliesArgument(argument, context),
  );
}

/**
 * Whether the server can run `command` with no arguments given, in `context`: it is not
 * desktop-local and the context supplies every argument it requires.
 */
export function serverRunsWithContext(
  command: Pick<CommandDefinition, "executionTarget" | "arguments">,
  context: ArgumentContext,
): boolean {
  return runsOnServer(command) && unfilledRequiredArguments(command, context).length === 0;
}

const ID_SHAPE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

/**
 * Whether a value has the shape the server's ids have, rather than being a name.
 *
 * @param value - The value of a command argument.
 * @returns Whether it is an id's 32 hex digits, hyphenated or not.
 */
export function looksLikeId(value: string): boolean {
  return ID_SHAPE.test(value.trim());
}

/**
 * The argument types of a command's declared arguments.
 *
 * @param args - The arguments as the server declares them, when known.
 * @returns The types by argument name, or `undefined` when no arguments are known.
 */
export function argumentTypesOf(
  args: ReadonlyArray<{ name: string; argumentType: CommandArgumentType }> | undefined | null,
): Readonly<Record<string, CommandArgumentType>> | undefined {
  if (!args) return undefined;
  return Object.fromEntries(args.map((arg) => [arg.name, arg.argumentType]));
}

/** The argument types the argument form has a field for; the others come from the context. */
const FORM_ARGUMENT_TYPES: ReadonlySet<CommandArgumentType> = new Set([
  CommandArgumentType.STRING,
  CommandArgumentType.INTEGER,
  CommandArgumentType.FLOAT,
  CommandArgumentType.BOOLEAN,
  CommandArgumentType.ENUM,
  CommandArgumentType.USER_ID,
  CommandArgumentType.CONVERSATION_ID,
  CommandArgumentType.WORKSPACE_ID,
]);

/**
 * Whether the argument form can ask a person for `argument`: every type but a message, a thread
 * and selected text, which only the context supplies.
 */
export function formAsksFor(argument: Pick<CommandArgumentInfo, "argumentType">): boolean {
  return FORM_ARGUMENT_TYPES.has(argument.argumentType);
}

/**
 * What a person is told when a command lacks an argument of `type` that only the context
 * supplies, and that the argument form cannot ask for.
 */
export function contextOnlyArgumentMessage(type: CommandArgumentType): string {
  switch (type) {
    case CommandArgumentType.THREAD_ID:
      return "Open a thread first";
    case CommandArgumentType.SELECTION_TEXT:
      return "Select some text first";
    default:
      return "Select a message first";
  }
}

/**
 * Whether `args` hold a value for the argument called `name`, under its own snake_case name or
 * its camelCase spelling; an empty string counts as no value.
 */
export function argumentGiven(args: Record<string, unknown> | undefined, name: string): boolean {
  return isGivenValue(args?.[name]) || isGivenValue(args?.[camelCaseName(name)]);
}

/** The camelCase spelling of a snake_case argument name. */
export function camelCaseName(name: string): string {
  return name.replace(/_(\w)/g, (_, c: string) => c.toUpperCase());
}

function isGivenValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}
