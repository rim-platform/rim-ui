import { onlineManager } from "@tanstack/react-query";

import { queryKeys } from "../../../core/query/keys";
import { queryClient } from "../../../core/query/queryClient";
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

/**
 * The capability of a server with `User.isBot`, `User.bot`, `ServerMember.isBot` and
 * `ServerMember.bot`; such a server also lists {@link MESSAGE_FLAG}.
 */
export const BOT_DISCLOSURE = "bot_disclosure";

/** The capability of a server with incoming webhooks (`incomingWebhooks` and its mutations). */
export const INCOMING_WEBHOOKS = "incoming_webhooks";

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
