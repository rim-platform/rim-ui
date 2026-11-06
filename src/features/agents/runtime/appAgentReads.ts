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
import { useAgentRecordStore, type RecordEntry } from "../state/useAgentRecordStore";
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
 * The conversation by id from its workspace's server. Only when no server gave an answer, which a
 * failure of its own is not, does it fall back on the app's lists: a server saying no is the
 * person no longer seeing it.
 */
export async function lookup(workspaceId: string, channelId: string): Promise<GrantChannel | null> {
  let conversation: ConversationSummary | undefined;
  try {
    conversation = await fetchConversation(queryClient, workspaceId, channelId);
  } catch (error) {
    if (error instanceof ClientError && error.response.status < 500) return null;
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

/** The workspaces an agent can be answered about: those on this server, without direct spaces. */
export async function workspaces(): Promise<{ id: string; name: string }[]> {
  return (await fetchMyServers()).filter((server) => !isDirectSpace(server.id));
}

/** Whether the agent is connected to the unlocked account. */
export function connected(agentId: string): boolean {
  return useConnectedAgentsStore.getState().agents.some((agent) => agent.id === agentId);
}

/** Adds an entry to the record and writes it out. */
export async function record(entry: RecordEntry): Promise<void> {
  useAgentRecordStore.getState().add(entry);
  await flushSealedStorage();
}

/** The reads this app answers agents with. */
export const appAgentReads = createAgentReads({
  chat: appChatDeps,
  lookup,
  workspaces,
  channels,
  isDirectSpace,
  connected,
  record,
});
