/**
 * Cross-channel destination detector for the confirmation modal.
 *
 * A closed list of destination-bearing argument names. If a command's args
 * carry one of these and its value differs from the currently focused
 * conversation, the modal shows the cross-channel warning chip.
 *
 * The chip guards against a command reaching a conversation other than the
 * one in view, so it only says whether the destination differs; it does not
 * resolve the target to a channel name.
 */
const DESTINATION_ARG_NAMES: ReadonlyArray<string> = [
  "conversation_id",
  "channel_id",
  "dm_recipient_id",
  "target_conversation_id",
];

export interface CrossChannelInfo {
  targetId: string;
  argName: string;
}

/**
 * If `args` carry any destination-bearing key whose value is a non-empty
 * string differing from `currentConversationId`, return the resolved
 * mismatch info. Returns null when no destination arg is present, when
 * the value matches the current conversation, or when there is no current
 * conversation (no diff to report against).
 */
export function detectCrossChannel(
  args: Record<string, unknown>,
  currentConversationId: string | null,
): CrossChannelInfo | null {
  if (!currentConversationId) return null;

  for (const argName of DESTINATION_ARG_NAMES) {
    const value = args[argName];
    if (typeof value !== "string" || value.length === 0) continue;
    if (value === currentConversationId) continue;
    return { targetId: value, argName };
  }
  return null;
}
