/** The agent reads wired to the app: its conversations, its message service and its record. */

import { ClientError } from "graphql-request";

import { flushSealedStorage } from "../../../core/accountVault/sealedStorage";
import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";
import { queryClient } from "../../../core/query/queryClient";
import { BROWSE_FILTER, fetchChannels } from "../../conversations/api/useChannels";
import { fetchConversation, findCachedConversation } from "../../conversations/api/useConversation";
import type { ConversationSummary } from "../../conversations/types";
import { pinnedEncrypted } from "../../e2ee/runtime/pins";
import { appChatDeps } from "../../plugins/chat/appMessageService";
import { isDirectSpace } from "../../relay/state/useRelayStore";
import { fetchMyServers } from "../../workspaces/api/useMyServers";
import { useAgentRecordStore } from "../state/useAgentRecordStore";
import { useConnectedAgentsStore } from "../state/useConnectedAgentsStore";
import { createAgentReads, type AgentChannel } from "./agentReads";
import type { GrantChannel } from "./grants";

/**
 * A conversation as the grant check sees it: encrypted when this device pinned it so or the
 * server says so. A pin that cannot be read counts as encrypted.
 */
async function grantChannel(
  workspaceId: string,
  conversation: ConversationSummary,
): Promise<GrantChannel> {
  const pinned = await pinnedEncrypted(workspaceId, conversation.id).catch(() => true);
  return {
    id: conversation.id,
    isChannel: conversation.conversationType === ConversationTypeEnum.CHANNEL,
    encrypted: pinned || Boolean(conversation.encryptedAt),
  };
}

/**
 * The conversation by id from its workspace's server. Only when no server answered does it fall
 * back on the app's lists: a server saying no is the person no longer seeing it.
 */
async function lookup(workspaceId: string, channelId: string): Promise<GrantChannel | null> {
  let conversation: ConversationSummary | undefined;
  try {
    conversation = await fetchConversation(queryClient, workspaceId, channelId);
  } catch (error) {
    if (error instanceof ClientError) return null;
    conversation = findCachedConversation(queryClient, workspaceId, channelId);
  }
  return conversation ? grantChannel(workspaceId, conversation) : null;
}

async function channels(workspaceId: string): Promise<AgentChannel[]> {
  const page = await fetchChannels(workspaceId, BROWSE_FILTER);
  return Promise.all(
    page.items.map(async (conversation) => ({
      ...(await grantChannel(workspaceId, conversation)),
      name: conversation.title ?? "",
      private: conversation.isPrivate,
    })),
  );
}

/** The reads this app answers agents with. */
export const appAgentReads = createAgentReads({
  chat: appChatDeps,
  lookup,
  workspaces: async () => (await fetchMyServers()).filter((server) => !isDirectSpace(server.id)),
  channels,
  isDirectSpace,
  connected: (agentId) =>
    useConnectedAgentsStore.getState().agents.some((agent) => agent.id === agentId),
  record: async (entry) => {
    useAgentRecordStore.getState().add(entry);
    await flushSealedStorage();
  },
});
