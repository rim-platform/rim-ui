import type { CommandDefinition } from "../types";
import { argumentPromptName, hasLocalHandler } from "./commandDispatcher";
import { unfilledRequiredArguments, type ArgumentContext } from "./commandArguments";

/**
 * Whether a command can run as picked from the palette or the message box, with no arguments
 * typed: this app runs it itself, or every argument it requires comes from the context or from
 * the surface that asks for it.
 */
export function runsFromPalette(command: CommandDefinition, context: ArgumentContext): boolean {
  if (hasLocalHandler(command.id)) return true;
  const prompted = argumentPromptName(command.id);
  return unfilledRequiredArguments(command, context).every(
    (argument) => argument.name === prompted,
  );
}

/**
 * The names of the arguments `command` requires that neither the context, a prompt nor `given`
 * supplies, which a command run from the message box still has to be given.
 */
export function missingArgumentNames(
  command: CommandDefinition,
  context: ArgumentContext,
  given: Record<string, unknown> = {},
): string[] {
  if (hasLocalHandler(command.id)) return [];
  const prompted = argumentPromptName(command.id);
  return unfilledRequiredArguments(command, context)
    .filter((argument) => argument.name !== prompted && !isGiven(given[argument.name]))
    .map((argument) => argument.name);
}

function isGiven(value: unknown): boolean {
  return value !== undefined && value !== "";
}
