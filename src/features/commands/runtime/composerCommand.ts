import { toast } from "../../../shared/toast";
import type { CommandContextInput, CommandDefinition } from "../types";
import { argString, commandResultOf } from "./commandDispatcher";
import { currentCommandContext } from "./commandContext";
import { runWithHumanConfirmation } from "./humanConfirmation";
import { appOnlyStageError, pipeConfirmationSubject } from "./pipeStages";
import { conversationEncrypted } from "../../plugins/chat/appMessageService";
import { CANCELLED_PAYLOAD, isCancelledResult } from "../../plugins/runtime/pluginCommandInfo";
import { showCommandRefusal } from "./refusal";
import { runPersonCommand, type ExecuteBackend } from "./runPersonCommand";

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
 * Runs a command picked or typed in the message box as the command palette runs it, with the
 * arguments typed after its name, and tells the person how it went. The argument form asks for
 * what the typed arguments leave out or cannot be taken, starting with what was typed; with none
 * typed it is the palette's form. Message text is never sent in plain to an end-to-end encrypted
 * conversation, neither from the typed arguments nor from the form.
 *
 * @param command - The command picked in the box's list.
 * @param executeBackend - Sends it to the server, when the server runs it.
 * @param args - The arguments typed after its name, if any.
 */
export async function runComposerCommand(
  command: CommandDefinition,
  executeBackend: ExecuteBackend,
  args?: Record<string, unknown>,
): Promise<void> {
  const commandContext = currentCommandContext();
  if (await refusedForEncryption(command, args, commandContext)) return;
  // The form may have named another conversation: what reaches the server is checked again.
  const guarded: ExecuteBackend = async (input) => {
    const context = (input.commandContext ?? {}) as CommandContextInput;
    if (await refusedForEncryption(command, input.args, context)) {
      return {
        executeCommand: {
          status: "ERROR",
          message: "",
          payload: CANCELLED_PAYLOAD,
          followUpCommands: [],
        },
      };
    }
    return executeBackend(input);
  };
  await runPersonCommand(command, guarded, args, { commandContext, typed: true });
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
