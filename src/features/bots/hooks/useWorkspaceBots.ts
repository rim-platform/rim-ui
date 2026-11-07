import { useMemo } from "react";

import { ConversationTypeEnum, type BotInfo } from "../../../core/graphql/generated/schema-types";
import type { ConversationSummary } from "../../conversations/types";
import { useIsDirectSpace } from "../../relay/state/useRelayStore";
import { BOT_DISCLOSURE } from "../../updater/api/serverCapabilities";
import { useSpaceHasCapability } from "../../updater/hooks/useSpaceHasCapability";
import { useServerMembers, type ServerMember } from "../../workspaces/api/useServerMembers";

/** A bot of the workspace with what the person who added it says about it. */
export type WorkspaceBot = ServerMember & { isBot: true; bot: BotInfo };

function isWorkspaceBot(member: ServerMember): member is WorkspaceBot {
  return member.isBot === true && Boolean(member.bot);
}

/**
 * The workspace's active bots, by name, from the member list every member reads: a deactivated
 * bot has left it. Empty in the direct space and where the workspace's host does not list
 * `bot_disclosure`, which marks no member as a bot.
 *
 * @param workspaceId - The open workspace.
 */
export function useWorkspaceBots(workspaceId: string | null | undefined): WorkspaceBot[] {
  const inDirectSpace = useIsDirectSpace(workspaceId ?? null);
  const disclosed = useSpaceHasCapability(workspaceId, BOT_DISCLOSURE);
  const shown = Boolean(workspaceId) && !inDirectSpace && disclosed;
  const { data: members } = useServerMembers(shown ? (workspaceId ?? undefined) : undefined);
  return useMemo(
    () =>
      shown
        ? (members ?? [])
            .filter(isWorkspaceBot)
            .sort((a, b) => botName(a).localeCompare(botName(b)))
        : [],
    [shown, members],
  );
}

/** The name a bot goes by. */
export function botName(bot: WorkspaceBot): string {
  return bot.displayName || bot.username;
}

/**
 * The workspace's active bots that are members of `conversation`: none for a conversation that
 * is not a channel or is encrypted, which a bot can never join.
 *
 * @param bots - The workspace's active bots.
 * @param conversation - The open conversation.
 */
export function botsInChannel(
  bots: readonly WorkspaceBot[],
  conversation:
    Pick<ConversationSummary, "conversationType" | "memberIds" | "encryptedAt"> | undefined,
): WorkspaceBot[] {
  if (
    !conversation ||
    conversation.conversationType !== ConversationTypeEnum.CHANNEL ||
    conversation.encryptedAt
  ) {
    return [];
  }
  const members = new Set(conversation.memberIds);
  return bots.filter((bot) => members.has(bot.userId));
}
