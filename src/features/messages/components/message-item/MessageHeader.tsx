import { memo } from "react";
import { Pin } from "lucide-react";

import { activeBan, banLabel } from "../../hooks/useBanExpiry";
import { Avatar } from "../../../../shared/ui/Avatar";
import { UserHoverCard } from "../../../../shared/ui/UserHoverCard";
import { cn } from "../../../../shared/ui/cn";
import { useClockFormatStore } from "../../../../shared/state/useClockFormatStore";
import { formatTime } from "../../../../shared/utils/formatTime";
import { openDirectWithMember } from "../../../conversations/state/openDirect";
import { LockMark } from "../../../e2ee/components/LockMark";
import { MessageRoleBadge } from "../../../workspaces/components/MemberBadges";
import { sameAuthor } from "./areMessageItemPropsEqual";
import { useAuthorPresence } from "./useAuthorPresence";
import type { ForwardedFromInfo, MessageAuthorView, MessageItemHandlers } from "./types";

/** Shallow prop equality, except `author`, which is rebuilt by parents and compared by value. */
function authorPropsEqual<P extends { author: MessageAuthorView }>(prev: P, next: P): boolean {
  for (const key of Object.keys(next) as (keyof P)[]) {
    if (key === "author") continue;
    if (prev[key] !== next[key]) return false;
  }
  return sameAuthor(prev.author, next.author);
}

interface AuthorHoverProps {
  authorId: string;
  author: MessageAuthorView;
  children: React.ReactElement;
}

function AuthorHoverCard({ authorId, author, children }: AuthorHoverProps) {
  const presence = useAuthorPresence(authorId, author.presenceStatus);
  return (
    <UserHoverCard
      isFormerMember={author.isFormerMember}
      ban={author.ban}
      userId={authorId}
      username={author.username ?? author.name}
      handle={author.handle}
      displayName={author.name}
      avatarUrl={author.avatarUrl}
      statusText={author.statusText}
      role={author.role}
      joinedAt={author.joinedAt}
      bio={author.bio}
      presenceStatus={presence}
      isCurrentUser={author.isCurrentUser}
      onSendDm={
        author.isFormerMember || activeBan(author.ban)
          ? undefined
          : () => void openDirectWithMember(authorId)
      }
    >
      {children}
    </UserHoverCard>
  );
}

interface MessageAvatarProps {
  authorId: string;
  author: MessageAuthorView;
  compact: boolean;
  /** Binds the author's context menu to the avatar. */
  bindUserContextMenu?: MessageItemHandlers["bindUserContextMenu"];
}

export const MessageAvatar = memo(function MessageAvatar({
  authorId,
  author,
  compact,
  bindUserContextMenu,
}: MessageAvatarProps) {
  return (
    <AuthorHoverCard authorId={authorId} author={author}>
      <span
        className="cursor-pointer"
        {...(author.isFormerMember || activeBan(author.ban)
          ? {}
          : bindUserContextMenu?.({ userId: authorId, displayName: author.name }))}
      >
        <Avatar
          url={author.avatarUrl}
          name={author.name}
          userId={authorId}
          size={compact ? "xs" : "md"}
        />
      </span>
    </AuthorHoverCard>
  );
}, authorPropsEqual);

interface MessageHeaderProps {
  authorId: string;
  author: MessageAuthorView;
  sentAt: string;
  isPinned?: boolean;
  forwardedFromMessageId?: string | null;
  forwardedFrom?: ForwardedFromInfo | null;
  /** The message is end-to-end encrypted. */
  encrypted?: boolean;
  /** A plaintext message of a conversation that is encrypted now, sent before that. */
  beforeEncryption?: boolean;
  onNavigateToForwardedSource?: (conversationId: string, messageId: string) => void;
  /** Binds the author's context menu to their name. */
  bindUserContextMenu?: MessageItemHandlers["bindUserContextMenu"];
}

/**
 * Author line: name (with hover card and the author's context menu), time, pin, forwarded
 * marker and status.
 */
export const MessageHeader = memo(function MessageHeader({
  authorId,
  author,
  sentAt,
  isPinned,
  forwardedFromMessageId,
  forwardedFrom,
  encrypted,
  beforeEncryption,
  onNavigateToForwardedSource,
  bindUserContextMenu,
}: MessageHeaderProps) {
  useClockFormatStore((s) => s.clockFormat);
  return (
    <div className="flex items-baseline gap-2">
      <AuthorHoverCard authorId={authorId} author={author}>
        <span
          {...(author.isFormerMember || activeBan(author.ban)
            ? {}
            : bindUserContextMenu?.({ userId: authorId, displayName: author.name }))}
          className={cn(
            "text-sm font-medium cursor-pointer hover:underline",
            author.isCurrentUser ? "text-rim-accent" : "text-rim-text",
          )}
        >
          {author.name}
        </span>
      </AuthorHoverCard>
      {!author.inDirectSpace && !author.isFormerMember && !activeBan(author.ban) && (
        <MessageRoleBadge role={author.role} className="self-center" />
      )}
      {author.inDirectSpace && !author.isCurrentUser && author.handle && (
        <span className="text-xs text-rim-text-faint truncate max-w-[160px]">
          {author.handle.shown}
        </span>
      )}
      {activeBan(author.ban) ? (
        <span className="text-xs text-rim-text-muted">({banLabel(author.ban)})</span>
      ) : (
        author.isFormerMember && (
          <span className="text-xs text-rim-text-muted">(former member)</span>
        )
      )}
      <span className="text-xs text-rim-text-faint">{formatTime(sentAt)}</span>
      {encrypted && <LockMark className="self-center" />}
      {beforeEncryption && (
        <span className="text-xs text-rim-text-faint">sent before encryption</span>
      )}
      {isPinned && <Pin className="h-3 w-3 text-rim-accent" />}
      {forwardedFromMessageId &&
        (forwardedFrom ? (
          <button
            type="button"
            onClick={() =>
              onNavigateToForwardedSource?.(forwardedFrom.conversationId, forwardedFrom.id)
            }
            className="text-xs text-rim-text-faint hover:text-rim-accent transition-colors cursor-pointer"
          >
            {"↪"} Forwarded
            {forwardedFrom.author?.displayName ? ` from ${forwardedFrom.author.displayName}` : ""}
          </button>
        ) : (
          <span className="text-xs text-rim-text-faint">{"↪"} Forwarded</span>
        ))}
      {author.statusText && (
        <span className="text-xs text-rim-text-faint truncate max-w-[160px]">
          {author.statusText}
        </span>
      )}
    </div>
  );
}, authorPropsEqual);
