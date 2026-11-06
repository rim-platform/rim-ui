import type { ConversationSummary } from "../conversations/types";

/** Why a channel cannot be changed by the viewer, or null when it can. */
export function channelBlockedReason(channel: ConversationSummary): string | null {
  return channel.isPrivate && !channel.isMember
    ? "You are not in this private channel, so you cannot add a bot to it."
    : null;
}
