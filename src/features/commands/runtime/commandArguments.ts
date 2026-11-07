import { CommandArgumentType } from "../../../core/graphql/generated/schema-types";
import type { CommandArgumentInfo, CommandContextInput, CommandDefinition } from "../types";
import { runsOnServer } from "./serverRunnable";

/** The parts of a command's context the server fills arguments from. */
export type ArgumentContext = Pick<CommandContextInput, "workspaceId" | "conversationId">;

/**
 * Whether the server takes `argument` from `context` when the caller leaves it out: a
 * workspace argument from the context's workspace, a conversation argument from its
 * conversation.
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
