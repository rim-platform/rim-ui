export interface MessageEventData {
  id: string;
  server_id: string;
  conversation_id: string;
  thread_id: string | null;
  root_thread_id: string | null;
  author_id: string;
  text: string | null;
  has_attachments: boolean;
  parent_message_id: string | null;
  forwarded_from_message_id: string | null;
  is_deleted: boolean;
  sent_at: string;
  reactions: ReactionGroupData[];
  /** Set on an encrypted message, whose `text` is null. Binary values are base64url. */
  encryption?: {
    incarnation: number;
    epoch: number;
    sender_device_id: string;
    ciphertext: string | null;
    franking_receipt: string;
    franking_key_id: number;
    /** Decimal microseconds. */
    sent_at_us: string;
  } | null;
}

export interface ReactionGroupData {
  emoji: string;
  count: number;
  user_ids: string[];
}

/** Why a `NotificationDue` was sent; lowercase on the wire (`NotificationReason` in GraphQL). */
export type NotificationDueReason = "direct" | "mention" | "keyword" | "thread_reply" | "all";

export type WorkspaceEvent =
  | {
      type: "NewMessage";
      workspace_id: string;
      conversation_id: string;
      message: MessageEventData;
    }
  | {
      type: "MessageUpdated";
      workspace_id: string;
      conversation_id: string;
      message: MessageEventData;
    }
  | {
      type: "MessageDeleted";
      workspace_id: string;
      conversation_id: string;
      message_id: string;
      thread_id: string | null;
    }
  | {
      type: "ReactionsUpdated";
      workspace_id: string;
      conversation_id: string;
      message_id: string;
      reactions: ReactionGroupData[];
    }
  | {
      type: "ConversationCreated";
      workspace_id: string;
      conversation_id: string;
      title: string | null;
      conversation_type: string;
    }
  | {
      type: "MemberJoined";
      workspace_id: string;
      user_id: string;
      username: string;
    }
  /**
   * A member was kicked or banned. Delivered to the workspace (a guest only hears about
   * themselves), including the removed user, whose subscription then ends.
   */
  | {
      type: "MemberLeft";
      workspace_id: string;
      user_id: string;
      cause?: string | null;
      until?: string | null;
      reason?: string | null;
    }
  | { type: "MemberBanChanged"; workspace_id: string; user_id: string }
  /**
   * A member's role changed. `role` is the lowercase name: `owner`, `moderator`, `member` or
   * `guest`. Same visibility as `MemberLeft`.
   */
  | {
      type: "MemberRoleChanged";
      workspace_id: string;
      user_id: string;
      role: string;
    }
  | {
      type: "ThreadCreated";
      workspace_id: string;
      conversation_id: string;
      thread_id: string;
      root_message_id: string;
    }
  | {
      type: "ReadStateUpdated";
      workspace_id: string;
      conversation_id: string;
      user_id: string;
      last_read_at: string;
    }
  | {
      type: "PresenceChanged";
      workspace_id: string;
      user_id: string;
      status: string;
    }
  | {
      type: "MemberAddedToConversation";
      workspace_id: string;
      conversation_id: string;
      user_id: string;
    }
  | {
      type: "MemberRemovedFromConversation";
      workspace_id: string;
      conversation_id: string;
      user_id: string;
    }
  | {
      /** Topic or archive state changed; the payload carries ids only, so refetch. */
      type: "ConversationUpdated";
      workspace_id: string;
      conversation_id: string;
    }
  | {
      type: "TypingStarted";
      workspace_id: string;
      conversation_id: string;
      user_id: string;
      /** Sent by servers that name the typist; older ones send only the ids. */
      username?: string;
      display_name?: string | null;
    }
  | {
      type: "MessagePinned";
      workspace_id: string;
      conversation_id: string;
      message_id: string;
    }
  | {
      type: "MessageUnpinned";
      workspace_id: string;
      conversation_id: string;
      message_id: string;
    }
  | {
      type: "UserMentioned";
      workspace_id: string;
      conversation_id: string;
      message_id: string;
      mentioned_by: string;
    }
  /**
   * The server decided the viewer should be told about a message. Delivered only to `user_id`.
   * `quiet` is true inside the viewer's do-not-disturb window or pause: the notification is
   * stored (inbox, digest) but the client must neither toast nor play a sound.
   */
  | {
      type: "NotificationDue";
      workspace_id: string;
      user_id: string;
      notification_id: string;
      conversation_id: string;
      message_id: string;
      reason: NotificationDueReason;
      quiet: boolean;
    }
  | {
      type: "LinkPreviewReady";
      workspace_id: string;
      conversation_id: string;
      message_id: string;
    }
  | {
      type: "WorkspaceStateChanged";
      workspace_id: string;
      key: string;
      scope: "SERVER" | "USER";
      value: unknown;
      user_id: string | null;
      version: number;
    }
  | {
      type: "WorkspaceStateDeleted";
      workspace_id: string;
      key: string;
      scope: "SERVER" | "USER";
      user_id: string | null;
    }
  | {
      type: "PipelineFired";
      workspace_id: string;
      pipeline_id: string;
      pipeline_name: string;
      trigger_event: string;
      actions_executed: number;
    }
  | {
      type: "PipelineSuspended";
      workspace_id: string;
      pipeline_id: string;
      pipeline_name: string;
      reason: string;
    }
  /**
   * An entry of the workspace's plugin registry was added, updated or removed. Visible to
   * every member, guests included; it carries no entry data, so clients refetch
   * `workspacePlugins`.
   */
  | {
      type: "WorkspacePluginChanged";
      workspace_id: string;
      plugin_id: string;
      change: "added" | "updated" | "removed";
    }
  /** A Commit of an encrypted conversation's group was accepted; `epoch` is the Commit's. */
  | {
      type: "MlsCommitAccepted";
      workspace_id: string;
      conversation_id: string;
      incarnation: number;
      epoch: number;
    }
  /** An encrypted conversation's pending adds or removes changed. */
  | {
      type: "MlsMembershipChanged";
      workspace_id: string;
      conversation_id: string;
    }
  /** A Welcome waits for `device_id` of `user_id`; other devices ignore it. */
  | {
      type: "MlsWelcomeAvailable";
      workspace_id: string;
      conversation_id: string;
      user_id: string;
      device_id: string;
    }
  /**
   * Someone added this person to a DM or group homed in another relay's direct space; it
   * arrives only through the relay, on the person's own stream.
   */
  | {
      type: "DmInvite";
      workspace_id: string;
      conversation_id: string;
      from_principal_id: string;
      from_card: { payload: string; signature: string };
      member_principal_ids: string[];
    };
