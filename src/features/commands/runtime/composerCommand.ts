import { toast } from "../../../shared/toast";
import type { CommandDefinition, CommandResult } from "../types";
import { commandResultOf, dispatchCommand } from "./commandDispatcher";
import { currentCommandContext } from "./commandContext";
import { showCommandOutcome } from "./commandOutcome";
import { missingArgumentNames } from "./commandRunnable";
import { runWithHumanConfirmation, type ConfirmationProof } from "./humanConfirmation";
import { appOnlyStageError, pipeConfirmationSubject } from "./pipeStages";
import { isCancelledResult } from "../../plugins/runtime/pluginCommandInfo";
import { showCommandRefusal } from "./refusal";

/** Sends one command to the server, as the mutation of the surface that runs it does. */
export type ExecuteBackend = (input: {
  commandId: string;
  args?: Record<string, unknown>;
  commandContext?: Record<string, unknown>;
  isPipe?: boolean;
  confirmation?: ConfirmationProof;
}) => Promise<{ executeCommand: CommandResult }>;

function normalized(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * The command a message box line names: its whole text after the leading `/` is a command's id
 * or title, ignoring case and spacing. An id wins over a title.
 *
 * @returns The command, or `null` when the line names none (it is then ordinary text).
 */
export function findCommandByText(
  text: string,
  commands: readonly CommandDefinition[] | undefined,
): CommandDefinition | null {
  if (!commands || !text.startsWith("/")) return null;
  const wanted = normalized(text.slice(1));
  if (!wanted) return null;
  return (
    commands.find((cmd) => normalized(cmd.id) === wanted) ??
    commands.find((cmd) => normalized(cmd.title) === wanted) ??
    null
  );
}

/**
 * Whether `command` needs arguments the message box cannot take; when it does, says which in an
 * error toast.
 */
export function lacksArguments(command: CommandDefinition): boolean {
  const missing = missingArgumentNames(command, currentCommandContext());
  if (missing.length === 0) return false;
  const names =
    missing.length > 1
      ? `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`
      : missing[0];
  toast.error(`${command.title} needs ${names}. The message box cannot take arguments yet.`);
  return true;
}

/**
 * Runs a command picked or typed in the message box and tells the person how it went: its
 * result or a refusal card. Its confirmation, argument prompt and target picker open as they do
 * from the palette.
 */
export async function runComposerCommand(
  command: CommandDefinition,
  executeBackend: ExecuteBackend,
): Promise<void> {
  const commandContext = currentCommandContext();
  const run = async (): Promise<void> => {
    try {
      const result = await dispatchCommand(command, executeBackend, { commandContext });
      await showCommandOutcome(command, result, undefined, commandContext);
    } catch (err: unknown) {
      showCommandRefusal(command.title, err, () => void run());
    }
  };
  await run();
}

/**
 * Runs a piped line (`/a | b`) and says how it went: a refusal of its stages, the stage that
 * failed, or that every stage ran. A confirmation the server asks for opens its dialog.
 */
export async function runComposerPipe(
  line: string,
  commands: readonly CommandDefinition[] | undefined,
  executeBackend: ExecuteBackend,
): Promise<void> {
  const segments = line
    .slice(1)
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
  const appOnly = appOnlyStageError(segments, commands ?? []);
  if (appOnly) {
    toast.error(appOnly);
    return;
  }
  const subject = pipeConfirmationSubject(segments, commands);
  try {
    const outcome = await runWithHumanConfirmation(async (confirmation) => {
      const res = await executeBackend({
        commandId: segments.join(" | "),
        commandContext: currentCommandContext(),
        isPipe: true,
        confirmation,
      });
      return res.executeCommand;
    }, subject);
    const result = commandResultOf(outcome);
    if (isCancelledResult(result)) return;
    if (result.status === "ERROR") {
      const failed = result.pipelineStages?.find((s) => s.status === "ERROR");
      toast.error(
        failed
          ? `Pipe failed at stage ${failed.stageIndex + 1}: ${failed.message}`
          : `Pipe failed: ${result.message}`,
      );
      return;
    }
    toast.success(`Piped ${segments.length} commands successfully`);
  } catch (err: unknown) {
    showCommandRefusal("Pipe", err);
  }
}
