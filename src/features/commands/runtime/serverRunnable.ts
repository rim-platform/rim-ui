import {
  CommandExecutionTarget,
  CommandSensitivity,
} from "../../../core/graphql/generated/schema-types";
import type { CommandDefinition } from "../types";

/**
 * Whether the server can run a command as a macro step or a pipeline action. It refuses
 * desktop-local commands, which only run in the app.
 *
 * @param command - The command's registry entry.
 * @returns `false` for a desktop-local command, `true` otherwise.
 */
export function runsOnServer(command: Pick<CommandDefinition, "executionTarget">): boolean {
  return command.executionTarget !== CommandExecutionTarget.DESKTOP_LOCAL;
}

/**
 * Whether the server skips a command where nobody can confirm it, as in a pipeline action: a
 * dangerous command, and any command of the Mutating or Restricted tier.
 *
 * @param command - The command's registry entry.
 * @returns `true` when the command needs a confirmation an unattended run cannot give.
 */
export function skippedUnattended(
  command: Pick<CommandDefinition, "dangerous" | "sensitivity">,
): boolean {
  return (
    command.dangerous ||
    command.sensitivity === CommandSensitivity.MUTATING ||
    command.sensitivity === CommandSensitivity.RESTRICTED
  );
}
