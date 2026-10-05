import type {
  IncidentTagInfo,
  MessageAuthorView,
  MessageItemMessage,
  MessageItemProps,
  MessageViewModel,
  Reaction,
} from "./types";

export function sameAuthor(a: MessageAuthorView, b: MessageAuthorView): boolean {
  return (
    a === b ||
    (a.name === b.name &&
      a.avatarUrl === b.avatarUrl &&
      a.username === b.username &&
      a.statusText === b.statusText &&
      a.role === b.role &&
      a.joinedAt === b.joinedAt &&
      a.bio === b.bio &&
      a.presenceStatus === b.presenceStatus &&
      a.isCurrentUser === b.isCurrentUser)
  );
}

function sameList<T>(
  a: readonly T[] | undefined,
  b: readonly T[] | undefined,
  same: (x: T, y: T) => boolean,
): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!same(a[i], b[i])) return false;
  }
  return true;
}

function sameReaction(a: Reaction, b: Reaction): boolean {
  return (
    a.emoji === b.emoji &&
    a.count === b.count &&
    a.reactedByMe === b.reactedByMe &&
    (a.userIds?.length ?? 0) === (b.userIds?.length ?? 0)
  );
}

function sameMessage(a: MessageItemMessage, b: MessageItemMessage): boolean {
  if (a === b) return true;
  return (
    a.id === b.id &&
    a.serverId === b.serverId &&
    a.text === b.text &&
    a.authorId === b.authorId &&
    a.sentAt === b.sentAt &&
    a.threadId === b.threadId &&
    a.rootThreadId === b.rootThreadId &&
    a.isPinned === b.isPinned &&
    a.isDeleted === b.isDeleted &&
    a.forwardedFromMessageId === b.forwardedFromMessageId &&
    a.forwardedFrom?.id === b.forwardedFrom?.id &&
    sameList(a.reactions, b.reactions, sameReaction) &&
    sameList(a.attachments, b.attachments, (x, y) => x.id === y.id && x.status === y.status) &&
    sameList(a.linkPreviews, b.linkPreviews, (x, y) => x.id === y.id)
  );
}

function sameView(a: MessageViewModel, b: MessageViewModel): boolean {
  if (a === b) return true;
  return (
    a.isSelected === b.isSelected &&
    a.isHighlighted === b.isHighlighted &&
    a.isDeleteConfirming === b.isDeleteConfirming &&
    a.isEditing === b.isEditing &&
    a.editError === b.editError &&
    a.isGrouped === b.isGrouped &&
    a.isFirstInGroup === b.isFirstInGroup &&
    a.displayDensity === b.displayDensity &&
    sameAuthor(a.author, b.author) &&
    sameMessage(a.message, b.message) &&
    sameList<IncidentTagInfo>(a.incidentTags, b.incidentTags, (x, y) => x.tagType === y.tagType)
  );
}

/**
 * Memo comparator for MessageItem (true = skip re-render). The view model is
 * compared by value because parents rebuild it each render; handlers and the
 * member directory are compared by reference, so they must be stable.
 */
export function areMessageItemPropsEqual(prev: MessageItemProps, next: MessageItemProps): boolean {
  return (
    prev.handlers === next.handlers &&
    prev.members === next.members &&
    sameView(prev.view, next.view)
  );
}
