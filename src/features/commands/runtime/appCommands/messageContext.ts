import { toast } from "../../../../shared/toast";
import {
  useSelectedMessageStore,
  type SelectedMessageActions,
} from "../../../messages/state/useSelectedMessageStore";
import { currentCommandContext } from "../commandContext";

/** What a command that acts on the selected message tells the person when none is selected. */
export const SELECT_A_MESSAGE = "Select a message first";

/** What a command that acts on the open conversation tells the person when none is open. */
export const OPEN_A_CONVERSATION = "Open a conversation first";

/**
 * The message a command acts on: the context's selected message, else the one selected in the
 * open conversation's message list.
 */
export function selectedMessageOf(
  commandContext: Record<string, unknown> | undefined,
): string | undefined {
  const id = (commandContext ?? currentCommandContext()).selectedMessageId;
  return typeof id === "string" && id !== "" ? id : undefined;
}

/**
 * The actions of the message list on screen when it shows the conversation the command runs in;
 * `null`, after saying so in a toast, when none does.
 */
export function openMessageList(
  commandContext: Record<string, unknown> | undefined,
): SelectedMessageActions | null {
  const ctx = commandContext ?? currentCommandContext();
  const actions = useSelectedMessageStore.getState().actions;
  if (!actions || actions.conversationId !== ctx.conversationId) {
    toast.info(OPEN_A_CONVERSATION);
    return null;
  }
  return actions;
}

/**
 * The selected message with the message list on screen that holds it, for the commands that act
 * on it as that list does; `null`, after saying so in a toast, when no message is selected or no
 * list shows its conversation.
 */
export function selectedMessageInList(
  commandContext: Record<string, unknown> | undefined,
): { messageId: string; actions: SelectedMessageActions } | null {
  const ctx = commandContext ?? currentCommandContext();
  const messageId = selectedMessageOf(ctx);
  const actions = useSelectedMessageStore.getState().actions;
  if (!messageId || !actions || actions.conversationId !== ctx.conversationId) {
    toast.info(SELECT_A_MESSAGE);
    return null;
  }
  return { messageId, actions };
}
