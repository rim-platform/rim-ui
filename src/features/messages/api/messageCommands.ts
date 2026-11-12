import { queryClient } from "../../../core/query/queryClient";
import type { CommandContextTarget } from "../../commands/runtime/commandContext";
import {
  runCommandFromClick,
  type ClickOptions,
  type ClickOutcome,
  type ClickSource,
} from "../../commands/runtime/runFromClick";
import { unpinWithMutation } from "./usePinMessage";

/** The command that pins a message. */
export const PIN_MESSAGE_COMMAND = "chat.pin_message";

/** The command that unpins a message. */
export const UNPIN_MESSAGE_COMMAND = "chat.unpin_message";

/** The message a control acts on: its workspace, conversation and thread, and the message. */
export type MessageTarget = CommandContextTarget & {
  conversationId: string;
  selectedMessageId: string;
};

/**
 * Pins or unpins a message with `chat.pin_message` or `chat.unpin_message`, as the palette runs
 * them on that message. An unpin on a server that does not list `chat.unpin_message` uses the
 * `unpinMessage` mutation instead.
 *
 * @param target - The message and where it is.
 * @param pin - `true` pins it, `false` unpins it.
 * @param options - The kind of control, and the toast a success shows (none when left out).
 * @returns How the command ended.
 */
export function runPinCommand(
  target: MessageTarget,
  pin: boolean,
  options: { source: ClickSource; successToast?: ClickOptions["successToast"] },
): Promise<ClickOutcome> {
  return runCommandFromClick(pin ? PIN_MESSAGE_COMMAND : UNPIN_MESSAGE_COMMAND, undefined, {
    source: options.source,
    target,
    successToast: options.successToast ?? null,
    ...(!pin && {
      fallback: () =>
        unpinWithMutation(queryClient, {
          serverId: target.workspaceId,
          conversationId: target.conversationId,
          messageId: target.selectedMessageId,
        }),
    }),
  });
}

/** The command that adds or removes the person's reaction on a message. */
export const TOGGLE_REACTION_COMMAND = "chat.toggle_reaction";

/**
 * Adds or removes the person's `emoji` reaction on a message with `chat.toggle_reaction`, as the
 * palette runs it on that message. A success shows no toast: the reaction shows on the message.
 *
 * @param target - The message and where it is.
 * @param emoji - The reaction.
 * @param source - The kind of control.
 * @returns How the command ended.
 */
export function runReactionCommand(
  target: MessageTarget,
  emoji: string,
  source: ClickSource,
): Promise<ClickOutcome> {
  return runCommandFromClick(
    TOGGLE_REACTION_COMMAND,
    { emoji },
    { source, target, successToast: null },
  );
}
