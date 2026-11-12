import type { CommandDefinition } from "../types";
import { argumentPromptName, hasLocalHandler, typedArgumentsGoToServer } from "./commandDispatcher";
import { formAsksFor, unfilledRequiredArguments, type ArgumentContext } from "./commandArguments";
import { presetFields } from "./argumentValues";
import { AGENT_MANAGEMENT_COMMAND_IDS } from "./appCommands/agentCommandIds";

/**
 * The names of the arguments `command` requires that neither `context`, its argument prompt nor
 * `given` supplies. With `formAsks`, an argument the argument form can ask for counts as
 * supplied too.
 */
function unsuppliedArguments(
  command: CommandDefinition,
  context: ArgumentContext,
  given: Record<string, unknown> = {},
  formAsks = false,
): string[] {
  const prompted = argumentPromptName(command.id);
  return unfilledRequiredArguments(command, context)
    .filter(
      (argument) =>
        argument.name !== prompted &&
        !isGiven(given[argument.name]) &&
        !(formAsks && formAsksFor(argument)),
    )
    .map((argument) => argument.name);
}

/**
 * Whether a command can run as picked from the palette, with no arguments typed: this app runs
 * it itself, or every argument it requires comes from the context, from the surface that asks for
 * it or from the argument form.
 */
export function runsFromPalette(command: CommandDefinition, context: ArgumentContext): boolean {
  return (
    hasLocalHandler(command.id) || unsuppliedArguments(command, context, {}, true).length === 0
  );
}

/**
 * A context with every part a command can take an argument from, as a keybind or a quick action
 * may find it when it runs: a workspace, an open conversation and a selected message.
 */
const EVERY_CONTEXT: ArgumentContext = {
  workspaceId: "workspace",
  conversationId: "conversation",
  selectedMessageId: "message",
};

/**
 * The names of the arguments a keybind or quick action to `command` would run without: those it
 * requires that neither this app's own handler, the context at its fullest, its argument prompt,
 * the argument form nor `presetArgs` supplies.
 *
 * @param command - The command the keybind or quick action names.
 * @param presetArgs - The arguments saved with it, when it has any.
 * @returns The missing names; empty when it can run.
 */
export function argumentsNoSurfaceSupplies(
  command: CommandDefinition,
  presetArgs?: Record<string, unknown>,
): string[] {
  if (hasLocalHandler(command.id)) return [];
  return unsuppliedArguments(command, EVERY_CONTEXT, presetArgs, true);
}

/** Whether a keybind or quick action with no arguments of its own can run `command`. */
export function runsWithoutArguments(command: CommandDefinition): boolean {
  return argumentsNoSurfaceSupplies(command).length === 0;
}

/**
 * Whether a keybind or quick action to `command` saves its arguments in fields, the same fields a
 * macro step offers: a built-in or app command with an argument the form has a field for, or one
 * this app asks for with a picker. The commands that manage agents save none.
 */
export function takesPresetFields(command: CommandDefinition): boolean {
  return (
    command.sourceKind !== "PLUGIN" &&
    !command.id.startsWith("plugin.") &&
    !AGENT_MANAGEMENT_COMMAND_IDS.has(command.id) &&
    presetFields(command).length > 0
  );
}

/** What a keybind or quick action whose command needs arguments it cannot have says about it. */
export const NEEDS_ARGUMENTS_NOTE = "Needs arguments this can't supply yet";

/**
 * Arguments a command this app runs itself still needs from the message box, which has no
 * selected message to take them from.
 */
const BOX_REQUIRED_ARGUMENTS: Readonly<Record<string, readonly string[]>> = {
  "chat.mark_as_unread": ["message_id"],
};

/** Commands the message box does not offer: they act on a selected message it cannot have. */
export const NOT_FROM_MESSAGE_BOX: ReadonlySet<string> = new Set([
  "chat.reply_to_selected_message",
]);

/**
 * The names of the arguments `command` requires that neither the context, a prompt nor `given`
 * supplies, which a command run from the message box still has to be given. A command this app
 * runs itself needs none, unless `given` sends it to the server instead.
 */
export function missingArgumentNames(
  command: CommandDefinition,
  context: ArgumentContext,
  given: Record<string, unknown> = {},
): string[] {
  if (hasLocalHandler(command.id) && !typedArgumentsGoToServer(command, given)) {
    return (BOX_REQUIRED_ARGUMENTS[command.id] ?? []).filter(
      (name) => !isGiven(given[name]) && !isGiven(given[camelCase(name)]),
    );
  }
  return unsuppliedArguments(command, context, given);
}

function camelCase(name: string): string {
  return name.replace(/_(\w)/g, (_, c: string) => c.toUpperCase());
}

function isGiven(value: unknown): boolean {
  return value !== undefined && value !== "";
}
