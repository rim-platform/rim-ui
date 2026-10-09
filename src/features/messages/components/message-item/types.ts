import type { MessageAttachment, MessageE2ee } from "../../../../core/types/messages";
import type { MessageTagType } from "../../../incidents/api/useIncident";
import type { DisplayDensity } from "../../../../shell/state/useShellStore";
import type { PresenceStatus } from "../../../../shared/ui/Avatar";
import type { LinkPreview } from "../LinkPreviewCard";

export interface IncidentTagInfo {
  tagType: MessageTagType;
}

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
  displayName: string;
  username?: string;
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
  name: string;
  avatarUrl?: string | null;
  username?: string;
  statusText?: string | null;
  role?: string;
  joinedAt?: string;
  bio?: string | null;
  /** Fallback when the presence store has no entry for the author. */
  presenceStatus?: PresenceStatus | null;
  isCurrentUser: boolean;
}

/** Everything a row needs to render, as plain data. */
export interface MessageViewModel {
  message: MessageItemMessage;
  author: MessageAuthorView;
  incidentTags?: IncidentTagInfo[];
  isSelected?: boolean;
  /** Briefly flashed after a search/permalink jump. */
  isHighlighted?: boolean;
  isDeleteConfirming?: boolean;
  isEditing?: boolean;
  editError?: boolean;
  isGrouped?: boolean;
  isFirstInGroup?: boolean;
  displayDensity?: DisplayDensity;
}

/**
 * Callbacks shared by every row. Parents must keep this object referentially
 * stable (useMemo over useCallback'd functions): the row memo compares it by
 * reference.
 */
export interface MessageItemHandlers {
  onOpenThread: (messageId: string) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onContextMenu?: (event: React.MouseEvent, messageId: string, messageText: string) => void;
  onSaveEdit?: (messageId: string, newText: string) => void;
  onCancelEdit?: () => void;
  onNavigateToForwardedSource?: (conversationId: string, messageId: string) => void;
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
