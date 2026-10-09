/**
 * Which host stream an event may arrive on: a conversation's events on `c:<conversation id>`,
 * one person's on `u:<principal id>` (this app's own only), other space-wide events on `w`,
 * typing and presence on `e` without a `seq`.
 */

/** Events for one person. Directory events about a guest go to the guest's stream too. */
const USER_EVENTS = new Set([
  "NotificationDue",
  "UserMentioned",
  "ReadStateUpdated",
  "MlsWelcomeAvailable",
  "DmInvite",
]);
const DIRECTORY_EVENTS = new Set(["MemberJoined", "MemberLeft", "MemberRoleChanged"]);
const EPHEMERAL_EVENTS = new Set(["TypingStarted", "PresenceChanged"]);

export interface StreamedEvent {
  stream: string;
  seq: number | null;
  event: { type: string; conversation_id?: unknown };
}

/** Whether `streamed` belongs on its stream, for the app of `principalId`. */
export function streamMatches(streamed: StreamedEvent, principalId: string): boolean {
  const { stream, seq, event } = streamed;
  const conversationId = typeof event.conversation_id === "string" ? event.conversation_id : null;
  if (stream === "e") return seq === null && EPHEMERAL_EVENTS.has(event.type);
  if (seq === null || EPHEMERAL_EVENTS.has(event.type)) return false;
  if (stream.startsWith("u:")) {
    return (
      stream.slice(2) === principalId &&
      (USER_EVENTS.has(event.type) || DIRECTORY_EVENTS.has(event.type))
    );
  }
  if (USER_EVENTS.has(event.type)) return false;
  if (stream.startsWith("c:")) return conversationId !== null && stream.slice(2) === conversationId;
  if (stream === "w") return conversationId === null;
  return false;
}
