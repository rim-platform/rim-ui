import { toast } from "../../../shared/toast";
import type { CommandContextInput, CommandDefinition, CommandResult } from "../types";
import { argString, commandResultOf, dispatchCommand } from "./commandDispatcher";
import { currentCommandContext } from "./commandContext";
import { showCommandOutcome } from "./commandOutcome";
import { missingArgumentNames } from "./commandRunnable";
import { runWithHumanConfirmation, type ConfirmationProof } from "./humanConfirmation";
import { appOnlyStageError, pipeConfirmationSubject } from "./pipeStages";
import { conversationEncrypted } from "../../plugins/chat/appMessageService";
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

/**
 * Whether `command` still lacks arguments after `given`; when it does, says which and the form to
 * type, in an error toast.
 */
export function lacksArguments(
  command: CommandDefinition,
  given: Record<string, unknown> = {},
): boolean {
  const missing = missingArgumentNames(command, currentCommandContext(), given);
  if (missing.length === 0) return false;
  toast.error(
    `${command.title} needs ${missing.join(", ")}. Type /${command.id} ${missing.map((n) => `${n}=...`).join(" ")}`,
  );
  return true;
}

/** Commands that carry a message's text, which an encrypted conversation must not receive in plain. */
const MESSAGE_TEXT_COMMANDS: ReadonlySet<string> = new Set([
  "chat.post_message",
  "chat.reply_to_selected_message",
  "chat.edit_message",
]);

/** Whether `command` carries a message's text: a known one, or any that declares a `text` argument. */
function carriesMessageText(command: CommandDefinition): boolean {
  return (
    MESSAGE_TEXT_COMMANDS.has(command.id) ||
    Boolean(command.arguments?.some((argument) => argument.name === "text"))
  );
}

/**
 * Whether `command` would send message text to the server in plain for an end-to-end encrypted
 * conversation, or one that cannot be told apart from it; when it would, says so in an error
 * toast.
 */
async function refusedForEncryption(
  command: CommandDefinition,
  args: Record<string, unknown> | undefined,
  context: CommandContextInput,
): Promise<boolean> {
  if (!carriesMessageText(command)) return false;
  const conversationId =
    argString(args, "conversation_id", "conversationId") ?? context.conversationId;
  const workspaceId = argString(args, "server_id", "serverId") ?? context.workspaceId;
  if (!conversationId || !workspaceId) return false;
  if ((await conversationEncrypted(workspaceId, conversationId)) === false) return false;
  toast.error(
    `${command.title} would send your text to the server unencrypted, and this conversation is end-to-end encrypted or cannot be checked. Write the message in the box instead.`,
  );
  return true;
}

/**
 * Runs a command picked or typed in the message box, with the arguments typed after it, and tells
 * the person how it went: its result or a refusal card. Its confirmation, argument prompt and
 * target picker open as they do from the palette.
 */
export async function runComposerCommand(
  command: CommandDefinition,
  executeBackend: ExecuteBackend,
  args?: Record<string, unknown>,
): Promise<void> {
  const commandContext = currentCommandContext();
  if (await refusedForEncryption(command, args, commandContext)) return;
  const run = async (): Promise<void> => {
    try {
      const result = await dispatchCommand(command, executeBackend, {
        args,
        commandContext,
        typedArgs: true,
      });
      await showCommandOutcome(command, result, args, commandContext);
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
