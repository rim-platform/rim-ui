/**
 * Event payloads emitted through the event bus by useWorkspaceEvents.
 * Each feature module subscribes to the events it cares about.
 *
 * These are distinct from the raw WorkspaceEvent types — they are
 * higher-level, post-processed events ready for feature consumption.
 */

export interface UnreadIncrementEvent {
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
  username: string;
}

export interface NewMessageNotificationEvent {
  conversationId: string;
  authorId: string;
  messageText: string;
}

/** Well-known bus event type names */
export const BUS_EVENTS = {
  UNREAD_INCREMENT: "unread:increment",
  UNREAD_MARK_READ: "unread:markRead",
  PRESENCE_CHANGED: "presence:changed",
  TYPING_STARTED: "typing:started",
  NEW_MESSAGE_NOTIFICATION: "notification:newMessage",
} as const;
