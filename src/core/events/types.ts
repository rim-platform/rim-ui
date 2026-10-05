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
   * A member was kicked or banned (Track 1.2). Delivered to the workspace (a guest only hears
   * about themselves), including the removed user, whose subscription then ends.
   */
  | {
      type: "MemberLeft";
      workspace_id: string;
      user_id: string;
    }
  /**
   * A member's role changed (Track 1.2). `role` is the lowercase name: `owner`, `moderator`,
   * `member` or `guest`. Same visibility as `MemberLeft`.
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
      username: string;
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
   * The server decided the viewer should be told about a message (Track 1.3, verified against
   * `rim-server/docs/messaging.md`). Delivered only to `user_id`. `quiet` is true inside the
   * viewer's do-not-disturb window or pause: the notification is stored (inbox, digest) but the
   * client must neither toast nor play a sound.
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
   * Emitted when an alert ingest (or manual start) creates a new incident
   * (Track B2, `track-b2-alerts.md` §8). `severity` is `null` when the
   * source didn't map to a known severity. `conversation_type` is carried
   * so the subscription-visibility filter can treat `Channel` conversations
   * as visible to all workspace members (channels have no
   * `conversation_member` rows, so falling back to membership alone would
   * hide channel-scoped incidents) — matches the pattern already used by
   * `NewMessage`/`ConversationCreated`.
   *
   * NOT codegen-typed: this flows through the `workspaceEvents` JSON-string
   * subscription (see `useWorkspaceEvents.ts`), so there's no compile-time
   * link to the backend's `rim_services::events::types::WorkspaceEvent`
   * enum. **Verified against the backend on 2026-07-10**
   * (`rim_services/src/events/types.rs`): tag casing and field names below
   * match. Note the backend struct also declares a `member_user_ids` field,
   * but it's `#[serde(skip_serializing)]` — server-internal only (used to
   * build the subscription filter), never actually present in the JSON the
   * client receives — so it's deliberately **not** in this type. If the
   * backend shape changes again, re-verify — a mismatch makes
   * `handleEvent`'s case a silent no-op, since `JSON.parse` + a `switch`
   * won't throw on an unknown shape.
   */
  | {
      type: "IncidentDeclared";
      workspace_id: string;
      conversation_id: string;
      conversation_type: string;
      incident_id: string;
      severity: string | null;
      title: string;
    }
  /** Emitted on incident status changes (e.g. repeat alert firing, resolve). See `IncidentDeclared` above for the verified-shape caveat. */
  | {
      type: "IncidentUpdated";
      workspace_id: string;
      conversation_id: string;
      conversation_type: string;
      incident_id: string;
      status: string;
    }
  /**
   * An escalation step fired (Track C1b/C1c, `IncidentService::fire_escalation_step`).
   * **Verified 2026-07-11** against `rim_services/src/events/types.rs`: PascalCase tag,
   * snake_case fields, `conversation_type` carried for the same channel-visibility-bypass
   * reason as `IncidentDeclared`. `target_user_ids` IS serialized (the FE needs it to show
   * the paged toast); the backend struct also declares `member_user_ids`, but that one is
   * `#[serde(skip_serializing)]` — server-internal only, never present in the JSON the
   * client receives, so it's deliberately **not** in this type (same caveat as
   * `IncidentDeclared`/`IncidentUpdated` above — re-verify if the backend shape changes).
   */
  | {
      type: "EscalationStepFired";
      workspace_id: string;
      conversation_id: string;
      conversation_type: string;
      incident_id: string;
      escalation_policy_id: string;
      step_index: number;
      target_user_ids: string[];
    }
  /**
   * An incident was acknowledged (Track C1b/C1c, `IncidentService::acknowledge_incident`).
   * See `EscalationStepFired` above for the verified-shape caveat — same rules apply.
   */
  | {
      type: "IncidentAcknowledged";
      workspace_id: string;
      conversation_id: string;
      conversation_type: string;
      incident_id: string;
      acknowledged_by: string;
    };
