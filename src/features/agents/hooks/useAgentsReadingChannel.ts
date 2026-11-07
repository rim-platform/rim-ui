import { useMemo } from "react";

import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";
import type { ConversationSummary } from "../../conversations/types";
import { grantCovers } from "../runtime/grants";
import { useConnectedAgentsStore } from "../state/useConnectedAgentsStore";

/** A program connected on this device whose read grant covers a channel, and how. */
export interface AgentReadingChannel {
  id: string;
  name: string;
  /** Whether the grant is every channel of the workspace rather than this one by name. */
  everyChannel: boolean;
}

/**
 * The programs connected to this account on this device that may read `conversation`, by the
 * grants kept here. None for a direct message, a group or anything encrypted, which no grant
 * covers.
 *
 * @param workspaceId - The open workspace.
 * @param conversation - The open conversation.
 */
export function useAgentsReadingChannel(
  workspaceId: string | null | undefined,
  conversation: Pick<ConversationSummary, "id" | "conversationType" | "encryptedAt"> | undefined,
): AgentReadingChannel[] {
  const agents = useConnectedAgentsStore((s) => s.agents);
  return useMemo(() => {
    if (!workspaceId || !conversation) return [];
    const channel = {
      id: conversation.id,
      isChannel: conversation.conversationType === ConversationTypeEnum.CHANNEL,
      encrypted: Boolean(conversation.encryptedAt),
    };
    return agents
      .filter((agent) => grantCovers(agent.grants, workspaceId, channel))
      .map((agent) => ({
        id: agent.id,
        name: agent.name,
        everyChannel: Boolean(agent.grants[workspaceId]?.all),
      }));
  }, [agents, workspaceId, conversation]);
}
