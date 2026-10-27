import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { findCachedConversation } from "../../conversations/api/useConversation";
import {
  archiveConfirmation,
  leaveConfirmation,
} from "../../conversations/conversationActionTexts";
import { useConversationActionConfirmStore } from "../../conversations/state/useConversationActionConfirmStore";
import type { ConversationSummary } from "../../conversations/types";
import { conversationLabel, leaveNeedsConfirmation } from "../../conversations/utils";

const CONFIRMED_ACTIONS: Readonly<Record<string, "leave" | "archive">> = {
  "chat.leave_conversation": "leave",
  "chat.archive_channel": "archive",
};

function nonBlankString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Asks the user to confirm leaving or archiving a conversation, as its menu does, before the
 * command runs: archiving always, leaving a group or a private channel. The conversation is
 * the one `args` name (`conversation_id`, `server_id`), else the context's.
 *
 * @returns `true` when the command may run: it is neither action, needs no confirmation, or
 *   the user confirmed it.
 */
export async function confirmConversationCommand(
  commandId: string,
  args: Record<string, unknown> | undefined,
  commandContext: Record<string, unknown> | undefined,
): Promise<boolean> {
  const kind = CONFIRMED_ACTIONS[commandId];
  if (!kind) return true;
  const conversationId =
    nonBlankString(args?.conversation_id) ?? stringValue(commandContext?.conversationId);
  const workspaceId = nonBlankString(args?.server_id) ?? stringValue(commandContext?.workspaceId);
  const conversation =
    findCachedConversation(queryClient, workspaceId, conversationId) ??
    queryClient.getQueryData<ConversationSummary>(
      queryKeys.conversation(workspaceId, conversationId),
    );
  if (kind === "leave" && conversation && !leaveNeedsConfirmation(conversation)) return true;
  const label = conversation
    ? conversationLabel(conversation)
    : kind === "archive"
      ? "this channel"
      : "this conversation";
  return useConversationActionConfirmStore
    .getState()
    .ask(kind === "archive" ? archiveConfirmation(label) : leaveConfirmation(label));
}
