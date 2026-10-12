/**
 * Cross-channel destination detector for the confirmation modal.
 *
 * Phase 4 uses a closed frontend list of "destination-bearing arg names".
 * If a command's args carry one of these AND its value differs from the
 * currently focused conversation, the modal shows the cross-channel
 * warning chip (§4.5).
 *
 * Phase 5 may move this to a backend-set flag
 * (`CommandArgument.is_destination_target: bool`) if the list grows or
 * plugins need to declare custom destination args.
 *
 * Phase 5+ TODO (spec §4.5 hovercard half): resolve `targetId` to a
 * channel name + topic + member count via the metadata layer, rendered as
 * a hover card in the warning chip. Deliberately deferred: the H2
 * mitigation is "destination differs, yes/no" — name resolution is
 * ergonomic polish, not load-bearing for the security property.
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
