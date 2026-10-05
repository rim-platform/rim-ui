import { memo } from "react";
import { Pin } from "lucide-react";

import { Avatar } from "../../../../shared/ui/Avatar";
import { UserHoverCard } from "../../../../shared/ui/UserHoverCard";
import { cn } from "../../../../shared/ui/cn";
import { formatTime } from "../../../../shared/utils/formatTime";
import { sameAuthor } from "./areMessageItemPropsEqual";
import { useAuthorPresence } from "./useAuthorPresence";
import type { ForwardedFromInfo, MessageAuthorView } from "./types";

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
      userId={authorId}
      username={author.username ?? author.name}
      displayName={author.name}
      avatarUrl={author.avatarUrl}
      statusText={author.statusText}
      role={author.role}
      joinedAt={author.joinedAt}
      bio={author.bio}
      presenceStatus={presence}
      isCurrentUser={author.isCurrentUser}
    >
      {children}
    </UserHoverCard>
  );
}

interface MessageAvatarProps {
  authorId: string;
  author: MessageAuthorView;
  compact: boolean;
}

export const MessageAvatar = memo(function MessageAvatar({
  authorId,
  author,
  compact,
}: MessageAvatarProps) {
  return (
    <AuthorHoverCard authorId={authorId} author={author}>
      <span className="cursor-pointer">
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
  messageId: string;
  authorId: string;
  author: MessageAuthorView;
  sentAt: string;
  isPinned?: boolean;
  isDeleted: boolean;
  rootThreadId?: string | null;
  forwardedFromMessageId?: string | null;
  forwardedFrom?: ForwardedFromInfo | null;
  onOpenThread: (messageId: string) => void;
  onNavigateToForwardedSource?: (conversationId: string, messageId: string) => void;
}

/** Author line: name (with hover card), time, pin, forwarded marker, status and thread link. */
export const MessageHeader = memo(function MessageHeader({
  messageId,
  authorId,
  author,
  sentAt,
  isPinned,
  isDeleted,
  rootThreadId,
  forwardedFromMessageId,
  forwardedFrom,
  onOpenThread,
  onNavigateToForwardedSource,
}: MessageHeaderProps) {
  return (
    <div className="flex items-baseline gap-2">
      <AuthorHoverCard authorId={authorId} author={author}>
        <span
          className={cn(
            "text-sm font-medium cursor-pointer hover:underline",
            author.isCurrentUser ? "text-rim-accent" : "text-rim-text",
          )}
        >
          {author.name}
        </span>
      </AuthorHoverCard>
      <span className="text-xs text-rim-text-faint">{formatTime(sentAt)}</span>
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
      {!isDeleted && rootThreadId && (
        <button
          type="button"
          onClick={() => onOpenThread(messageId)}
          className="text-xs text-rim-accent hover:underline"
        >
          thread
        </button>
      )}
    </div>
  );
}, authorPropsEqual);
