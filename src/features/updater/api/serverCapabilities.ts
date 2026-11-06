import { onlineManager } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import { queryClient } from "../../../core/query/queryClient";
import { hostOf } from "../../relay/state/useRelayStore";
import { fetchServerInfo, type KnownServerInfo } from "./serverInfoApi";

/** The capability of a server with `Message.editedAt`. */
export const MESSAGE_EDITED_AT = "message_edited_at";

/**
 * The capability of a server with `Message.flagged`, `MessageReport.automatic` and
 * `clearMessageFlag`; such a server also lists {@link MESSAGE_EDITED_AT}.
 */
export const MESSAGE_FLAG = "message_flag";

/** The capability of a server with `leaveWorkspace`. */
export const WORKSPACE_LEAVE = "workspace_leave";

/** The capability of a server with `renameWorkspace`. */
export const WORKSPACE_RENAME = "workspace_rename";

/** The capability of a server with `memberMessageCounts`, `deleteMemberMessages` and the `MessagesDeleted` event. */
export const DELETE_MEMBER_MESSAGES = "delete_member_messages";

/** The capability of a server with `ServerMember.timeoutReason` and the `MemberTimeoutChanged` event. */
export const MEMBER_TIMEOUT_CHANGED = "member_timeout_changed";

/** The capability of a server with `conversationMemberRemovals`. */
export const CONVERSATION_MEMBER_REMOVALS = "conversation_member_removals";

/** The capability of a server with the `notificationEvents` subscription. */
export const NOTIFICATION_EVENTS = "notification_events";

/** The capability of a server that keeps a command's `runId` and filters its audit log by it. */
export const COMMAND_RUN_ID = "command_run_id";

/**
 * The capability of a server with `User.isBot`, `User.bot`, `ServerMember.isBot` and
 * `ServerMember.bot`; such a server also lists {@link MESSAGE_FLAG}.
 */
export const BOT_DISCLOSURE = "bot_disclosure";

/** The capability of a server with incoming webhooks (`incomingWebhooks` and its mutations). */
export const INCOMING_WEBHOOKS = "incoming_webhooks";

/** The capability of a server with `UnreadCount.unreadAfter`, `markAsUnread` and the `ReadMarkerRewound` event. */
export const READ_MARKER = "read_marker";

/** Whether `info` lists `capability`; false while unknown or for an older server. */
export function hasCapability(info: KnownServerInfo | undefined, capability: string): boolean {
  return info?.capabilities?.includes(capability) ?? false;
}

/** The documents of one message read, by the newest message fields they ask for. */
export interface MessageReadDocuments<T> {
  plain: T;
  /** With `Message.editedAt`. */
  withEdits: T;
  /** With `Message.editedAt` and `Message.flagged`. */
  withFlags: T;
  /** With `Message.editedAt`, `Message.flagged` and the author's bot disclosure. */
  withBots: T;
}

/**
 * The document of a message read that the connected server answers: `withBots` when it lists
 * {@link BOT_DISCLOSURE}, `withFlags` when it lists {@link MESSAGE_FLAG}, `withEdits` when it lists {@link MESSAGE_EDITED_AT}, else `plain`.
 */
export async function messageReadDocument<T>(documents: MessageReadDocuments<T>): Promise<T> {
  if (await serverHasCapability(BOT_DISCLOSURE)) return documents.withBots;
  if (await serverHasCapability(MESSAGE_FLAG)) return documents.withFlags;
  if (await serverHasCapability(MESSAGE_EDITED_AT)) return documents.withEdits;
  return documents.plain;
}

/**
 * Whether the connected server lists `capability`, read from the cached server info (fetched
 * once when missing); false when it cannot be read. While the device is offline only the cached
 * server info is read, since a fetch would wait for the network.
 */
export async function serverHasCapability(capability: string): Promise<boolean> {
  if (!onlineManager.isOnline()) {
    return hasCapability(
      queryClient.getQueryData<KnownServerInfo>(queryKeys.serverInfo),
      capability,
    );
  }
  try {
    const info = await queryClient.ensureQueryData({
      queryKey: queryKeys.serverInfo,
      queryFn: fetchServerInfo,
      staleTime: Infinity,
      retry: false,
    });
    return hasCapability(info, capability);
  } catch {
    return false;
  }
}

const HOST_CAPABILITIES_QUERY = gql`
  query HostCapabilities {
    serverInfo {
      capabilities
    }
  }
`;

/** How long a host's capabilities are kept before they are read from it again. */
const HOST_CAPABILITIES_STALE_MS = 5 * 60 * 1000;

/**
 * Whether the server that hosts `spaceId` lists `capability`: the connected server for a space it
 * hosts, otherwise that host, asked through the same route as the space's other requests. False
 * when it cannot be read, or for a host older than capabilities, which refuses the question.
 */
export async function spaceHasCapability(spaceId: string, capability: string): Promise<boolean> {
  const host = hostOf(spaceId);
  if (!host) return serverHasCapability(capability);
  const queryKey = queryKeys.hostCapabilities(host);
  if (!onlineManager.isOnline()) {
    return queryClient.getQueryData<string[]>(queryKey)?.includes(capability) ?? false;
  }
  try {
    const capabilities = await queryClient.fetchQuery({
      queryKey,
      staleTime: HOST_CAPABILITIES_STALE_MS,
      retry: false,
      queryFn: async () => {
        // The operation declares no variable: `workspaceId` only routes the request to the host.
        const res = await graphqlClient.request<{ serverInfo: { capabilities: string[] } }>(
          HOST_CAPABILITIES_QUERY,
          { workspaceId: spaceId },
        );
        return res.serverInfo.capabilities;
      },
    });
    return capabilities.includes(capability);
  } catch {
    return false;
  }
}

/** The two documents of a read whose only newer part is the bot disclosure. */
export interface BotDisclosureDocuments<T> {
  plain: T;
  /** With the author's bot disclosure. */
  withBots: T;
}

/**
 * The document of a read that the connected server answers: `withBots` when it lists
 * {@link BOT_DISCLOSURE}, else `plain`.
 */
export async function botDisclosureDocument<T>(documents: BotDisclosureDocuments<T>): Promise<T> {
  return (await serverHasCapability(BOT_DISCLOSURE)) ? documents.withBots : documents.plain;
}
