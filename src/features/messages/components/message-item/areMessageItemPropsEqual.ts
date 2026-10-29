import type {
  MessageAuthorView,
  MessageItemMessage,
  MessageItemProps,
  MessageViewModel,
  Reaction,
  ReplyQuoteView,
} from "./types";

export function sameAuthor(a: MessageAuthorView, b: MessageAuthorView): boolean {
  return (
    a === b ||
    (a.isFormerMember === b.isFormerMember &&
      a.ban?.banned === b.ban?.banned &&
      a.ban?.bannedUntil === b.ban?.bannedUntil &&
      a.ban?.banReason === b.ban?.banReason &&
      a.name === b.name &&
      a.avatarUrl === b.avatarUrl &&
      a.username === b.username &&
      a.handle?.shown === b.handle?.shown &&
      a.handle?.copied === b.handle?.copied &&
      a.statusText === b.statusText &&
      a.role === b.role &&
      a.inDirectSpace === b.inDirectSpace &&
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
    a.conversationId === b.conversationId &&
    a.text === b.text &&
    a.authorId === b.authorId &&
    a.sentAt === b.sentAt &&
    a.editedAt === b.editedAt &&
    a.flagged === b.flagged &&
    a.threadId === b.threadId &&
    a.rootThreadId === b.rootThreadId &&
    a.isPinned === b.isPinned &&
    a.isDeleted === b.isDeleted &&
    a.forwardedFromMessageId === b.forwardedFromMessageId &&
    a.forwardedFrom?.id === b.forwardedFrom?.id &&
    a.parentMessageId === b.parentMessageId &&
    a.e2ee?.status === b.e2ee?.status &&
    a.e2ee?.rev === b.e2ee?.rev &&
    Boolean(a.encryption) === Boolean(b.encryption) &&
    a.beforeEncryption === b.beforeEncryption &&
    sameList(a.reactions, b.reactions, sameReaction) &&
    sameList(a.attachments, b.attachments, (x, y) => x.id === y.id && x.status === y.status) &&
    sameList(a.linkPreviews, b.linkPreviews, (x, y) => x.id === y.id)
  );
}

function sameReplyQuote(
  a: ReplyQuoteView | null | undefined,
  b: ReplyQuoteView | null | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  return a.messageId === b.messageId && a.authorName === b.authorName && a.excerpt === b.excerpt;
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
    a.inThreadPane === b.inThreadPane &&
    sameAuthor(a.author, b.author) &&
    sameReplyQuote(a.replyTo, b.replyTo) &&
    sameMessage(a.message, b.message)
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
