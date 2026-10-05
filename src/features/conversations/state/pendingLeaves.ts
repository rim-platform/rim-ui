/**
 * Conversations the viewer is leaving on purpose right now. The server answers a leave with a
 * `MemberRemovedFromConversation` event for the viewer, which can land before the mutation's
 * own response; the event handler checks this set so a voluntary leave does not also show the
 * "you were removed" toast.
 */
const leaving = new Set<string>();

export function markLeaving(conversationId: string): void {
  leaving.add(conversationId);
}

export function clearLeaving(conversationId: string): void {
  leaving.delete(conversationId);
}

export function isLeaving(conversationId: string): boolean {
  return leaving.has(conversationId);
}
