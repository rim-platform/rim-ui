/**
 * Event payloads emitted through the event bus by useWorkspaceEvents.
 * Each feature module subscribes to the events it cares about.
 *
 * These are distinct from the raw WorkspaceEvent types — they are
 * higher-level, post-processed events ready for feature consumption.
 */

import type { NotificationDueReason } from "./types";

export interface UnreadIncrementEvent {
  workspaceId: string;
  conversationId: string;
  authorId: string;
}

export interface UnreadMarkReadEvent {
  conversationId: string;
}

export interface PresenceChangedEvent {
  userId: string;
  status: string; // raw status string — feature normalizes it
}

export interface TypingStartedEvent {
  conversationId: string;
  userId: string;
  /** The name to show for the typist, resolved when the event arrives. */
  username: string;
}

/** A server-decided notification for the viewer (`NotificationDue`), ready to render. */
export interface NotificationDueBusEvent {
  workspaceId: string;
  notificationId: string;
  conversationId: string;
  messageId: string;
  reason: NotificationDueReason;
  quiet: boolean;
}

export interface WorkspaceStateChangedEvent {
  workspaceId: string;
  key: string;
  scope: "SERVER" | "USER";
}

export interface WorkspaceStateDeletedEvent {
  workspaceId: string;
  key: string;
  scope: "SERVER" | "USER";
}

export interface PipelineFiredEvent {
  workspaceId: string;
  pipelineId: string;
  pipelineName: string;
  triggerEvent: string;
  actionsExecuted: number;
}

export interface PipelineSuspendedEvent {
  workspaceId: string;
  pipelineId: string;
  pipelineName: string;
  reason: string;
}

/** Well-known bus event type names */
export const BUS_EVENTS = {
  UNREAD_INCREMENT: "unread:increment",
  UNREAD_MARK_READ: "unread:markRead",
  PRESENCE_CHANGED: "presence:changed",
  TYPING_STARTED: "typing:started",
  NOTIFICATION_DUE: "notification:due",
  WORKSPACE_STATE_CHANGED: "workspaceState:changed",
  WORKSPACE_STATE_DELETED: "workspaceState:deleted",
  PIPELINE_FIRED: "pipeline:fired",
  PIPELINE_SUSPENDED: "pipeline:suspended",
} as const;
