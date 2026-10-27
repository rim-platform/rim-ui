import type { AuthorBan } from "../../hooks/useBanExpiry";
import type { MessageAttachment, MessageE2ee } from "../../../../core/types/messages";
import type { DisplayDensity } from "../../../../shell/state/useShellStore";
import type { PresenceStatus } from "../../../../shared/ui/Avatar";
import type { HandleView } from "../../../../shared/utils/handles";
import type { LinkPreview } from "../LinkPreviewCard";
import type { ContextMenuBindings } from "../../../../shared/ui/contextMenu/useContextMenu";

export interface Reaction {
  emoji: string;
  count: number;
  reactedByMe: boolean;
  userIds?: string[];
}

export interface ForwardedFromInfo {
  id: string;
  conversationId: string;
  author: {
    id: string;
    username: string;
    displayName: string | null;
  } | null;
}

/** The message fields a timeline row renders. */
export interface MessageItemMessage {
  id: string;
  serverId?: string;
  text?: string | null;
  authorId: string;
  sentAt: string;
  threadId?: string | null;
  rootThreadId?: string | null;
  isPinned?: boolean;
  isDeleted?: boolean;
  forwardedFromMessageId?: string | null;
  forwardedFrom?: ForwardedFromInfo | null;
  /** The message this one replies to. */
  parentMessageId?: string | null;
  attachments?: MessageAttachment[];
  reactions?: Reaction[];
  linkPreviews?: LinkPreview[];
  conversationId?: string;
  /** What the desktop's cache keeps about an encrypted message. */
  e2ee?: MessageE2ee | null;
  /** Set on encrypted messages as the server returns them. */
  encryption?: unknown;
  /** A plaintext message sent before its conversation was encrypted. */
  beforeEncryption?: boolean;
}

export interface ResolvedMember {
  isFormerMember?: boolean;
  ban?: AuthorBan;
  displayName: string;
  username?: string;
  /** How the member's handle reads to the viewer. */
  handleView?: HandleView | null;
  isCurrentUser: boolean;
  avatarUrl?: string | null;
  statusText?: string | null;
  role?: string;
  joinedAt?: string;
  bio?: string | null;
}

export type MemberResolver = (userId: string) => ResolvedMember;

/** Author details resolved by the parent (member directory + message author). */
export interface MessageAuthorView {
  isFormerMember?: boolean;
  ban?: AuthorBan;
  name: string;
  avatarUrl?: string | null;
  username?: string;
  /** How the author's handle reads; derived from `username` when absent. */
  handle?: HandleView | null;
  statusText?: string | null;
  role?: string;
  joinedAt?: string;
  bio?: string | null;
  /** Fallback when the presence store has no entry for the author. */
  presenceStatus?: PresenceStatus | null;
  isCurrentUser: boolean;
}

/** The compact quote of the message a reply answers. */
export interface ReplyQuoteView {
  messageId: string;
  /** Null when the parent is not loaded. */
  authorName: string | null;
  /** The parent's first line as plain text, or a note when there is no text to show. */
  excerpt: string;
}

/** Everything a row needs to render, as plain data. */
export interface MessageViewModel {
  message: MessageItemMessage;
  author: MessageAuthorView;
  /** Set when the message replies to another one. */
  replyTo?: ReplyQuoteView | null;
  isSelected?: boolean;
  /** Briefly flashed after a search/permalink jump. */
  isHighlighted?: boolean;
  isDeleteConfirming?: boolean;
  isEditing?: boolean;
  editError?: boolean;
  isGrouped?: boolean;
  isFirstInGroup?: boolean;
  displayDensity?: DisplayDensity;
  /** The root shown at the top of the thread pane: no thread link and no Open thread action. */
  inThreadPane?: boolean;
}

/**
 * Callbacks and permissions shared by every row. Parents must keep this object referentially
 * stable (useMemo over useCallback'd functions): the row memo compares it by
 * reference.
 */
export interface MessageItemHandlers {
  onOpenThread: (messageId: string) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  /**
   * Whether the viewer may add reactions; when false a row offers only taking back their own.
   * Defaults to true.
   */
  canAddReaction?: boolean;
  /** Whether the viewer may start a thread on a message. Defaults to true. */
  canStartThread?: boolean;
  /** Starts a timeline reply to the message; absent where the viewer cannot post. */
  onReply?: (messageId: string) => void;
  onContextMenu?: (event: React.MouseEvent, messageId: string, messageText: string) => void;
  /** The handlers that open the row's context menu on a long press, for its touch events. */
  bindContextMenu?: (messageId: string, messageText: string) => ContextMenuBindings;
  /** The handlers that open the context menu of the person a name or an avatar shows. */
  bindUserContextMenu?: (target: { userId: string; displayName?: string }) => ContextMenuBindings;
  /**
   * Opens the context menu of a mentioned person, from a right click or the ContextMenu key on
   * the mention.
   */
  onMentionContextMenu?: (
    userId: string,
    mention: Element,
    event: React.MouseEvent | React.KeyboardEvent,
  ) => void;
  onSaveEdit?: (messageId: string, newText: string) => void;
  onCancelEdit?: () => void;
  onNavigateToForwardedSource?: (conversationId: string, messageId: string) => void;
  /** Scrolls to and flashes a message of the same conversation (a reply's parent). */
  onJumpToMessage?: (messageId: string) => void;
}

/** Member directory used for mention rendering and reaction tooltips. Stable per member list. */
export interface MessageMembers {
  resolve?: MemberResolver;
  /** userId -> displayName map for mention rendering */
  displayMap?: Map<string, string>;
}

export interface MessageItemProps {
  view: MessageViewModel;
  handlers: MessageItemHandlers;
  members?: MessageMembers;
}
