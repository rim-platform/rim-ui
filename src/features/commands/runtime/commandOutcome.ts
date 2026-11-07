import { toast } from "../../../shared/toast";
import {
  isCancelledResult,
  toastPluginCommandResult,
} from "../../plugins/runtime/pluginCommandInfo";
import type { CommandContextInput, CommandDefinition, CommandResult } from "../types";
import { isOpenPluginPanelCommand } from "../../plugins/pluginPanels";
import { isLocalActionResult } from "./commandDispatcher";
import { commandSuccessText } from "./commandResultText";
import { presentReadResult } from "./readCommandResult";

/**
 * Tells the person how a command they ran went: a plugin command in the words of its result, a
 * failure as an error toast, a plugin panel that cannot open as its reason, a read command as its result view, any other success as a toast
 * with its title and message. A declined confirmation and a command that shows what it did
 * itself say nothing more.
 *
 * @param command - The command that ran.
 * @param result - What the dispatcher returned for it.
 * @param args - The arguments it ran with, which the result view needs to look up encrypted
 *   messages.
 * @param commandContext - The context it ran in.
 * @returns `true` when a built-in command succeeded and the outcome was shown as a success.
 */
export async function showCommandOutcome(
  command: CommandDefinition,
  result: CommandResult | null,
  args?: Record<string, unknown>,
  commandContext?: CommandContextInput,
): Promise<boolean> {
  if (command.sourceKind === "PLUGIN" || command.id.startsWith("plugin.")) {
    // A plugin answers in words (its payload is for scripts and the agent).
    toastPluginCommandResult(command.title, result);
    return false;
  }
  if (isOpenPluginPanelCommand(command.id)) {
    // An open panel shows for itself; one that cannot open says why.
    if (result?.status === "ERROR") toast.error(result.message);
    return false;
  }
  if (isCancelledResult(result) || isLocalActionResult(result)) return false;
  if (result === null || result.status === "ERROR") {
    toast.error(`${command.title}: ${result?.message || "Command failed"}`);
    return false;
  }
  // A read command shows what it read; anything else says it ran.
  const shown = await presentReadResult(command.id, command.title, result, args, commandContext);
  if (!shown) toast.success(commandSuccessText(command.title, result));
  return true;
}
