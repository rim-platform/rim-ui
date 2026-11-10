import type { CommandContextInput, CommandDefinition, CommandResult } from "../types";
import { dispatchCommand } from "./commandDispatcher";
import { currentCommandContext } from "./commandContext";
import { showCommandOutcome } from "./commandOutcome";
import type { ConfirmationProof } from "./humanConfirmation";
import { showCommandRefusal } from "./refusal";

/** Sends one command to the server, as the mutation of the surface that runs it does. */
export type ExecuteBackend = (input: {
  commandId: string;
  args?: Record<string, unknown>;
  commandContext?: Record<string, unknown>;
  isPipe?: boolean;
  confirmation?: ConfirmationProof;
}) => Promise<{ executeCommand: CommandResult }>;

/** How {@link runPersonCommand} runs a command. */
export interface PersonRunOptions {
  /** Where the command runs; the current context when left out. */
  commandContext?: CommandContextInput;
  /**
   * The arguments were typed in the message box: a backend command runs on the server with them
   * even when this app has a handler of its own, and the argument form also opens for a typed
   * value it cannot take, showing the typed ones to change.
   */
  typed?: boolean;
  /** Called once the command has succeeded. */
  onSuccess?: () => void;
}

/**
 * Runs a command a person picked in the command palette or the message box and tells them how it
 * went: the argument form asks for what it lacks, its target picker, prompt and confirmation open
 * as they do anywhere, then its result or a refusal card shows. A refusal's retry runs it again
 * where it was started, with the arguments it ran with.
 *
 * @param command - The command to run.
 * @param executeBackend - Sends it to the server, when the server runs it.
 * @param args - The arguments given or typed with it, if any.
 * @param options - Where it runs and what was typed.
 */
export async function runPersonCommand(
  command: CommandDefinition,
  executeBackend: ExecuteBackend,
  args?: Record<string, unknown>,
  options: PersonRunOptions = {},
): Promise<void> {
  const commandContext = options.commandContext ?? currentCommandContext();
  const typed = options.typed === true && args !== undefined && Object.keys(args).length > 0;
  // The arguments it ran with, with any the argument form asked for.
  let ranWith = args;
  try {
    const result = await dispatchCommand(command, executeBackend, {
      args,
      commandContext,
      askForArguments: true,
      ...(typed ? { typedArgs: true, showTypedArguments: true } : {}),
      onArguments: (filled) => {
        ranWith = filled;
      },
    });
    if (await showCommandOutcome(command, result, ranWith, commandContext)) {
      options.onSuccess?.();
    }
  } catch (err) {
    showCommandRefusal(
      command.title,
      err,
      () => void runPersonCommand(command, executeBackend, ranWith, { ...options, commandContext }),
    );
  }
}
