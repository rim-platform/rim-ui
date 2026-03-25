import { useRef, useState, useCallback } from "react";
import { MessageSquare, SmilePlus } from "lucide-react";

import { EmojiPicker } from "../../../shared/ui/EmojiPicker";
import { HoverTooltip } from "../../../shared/ui/HoverTooltip";
import { cn } from "../../../shared/ui/cn";

interface Reaction {
  emoji: string;
  count: number;
  reactedByMe: boolean;
  userIds?: string[];
}

interface MessageItemMessage {
  id: string;
  text?: string | null;
  authorId: string;
  sentAt: string;
  threadId?: string | null;
  rootThreadId?: string | null;
}

type MemberResolver = (userId: string) => { displayName: string; isCurrentUser: boolean };

interface MessageItemProps {
  message: MessageItemMessage;
  authorName: string;
  authorInitial: string;
  isCurrentUser: boolean;
  reactions?: Reaction[];
  isSelected?: boolean;
  onOpenThread: (messageId: string) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onContextMenu: (event: React.MouseEvent, messageId: string, messageText: string) => void;
  resolveMember?: MemberResolver;
}

export function MessageItem({
  message,
  authorName,
  authorInitial,
  isCurrentUser,
  reactions,
  isSelected,
  onOpenThread,
  onToggleReaction,
  onContextMenu,
  resolveMember,
}: MessageItemProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  const getPickerPosition = useCallback(() => {
    if (!btnRef.current) return { x: 0, y: 0 };
    const rect = btnRef.current.getBoundingClientRect();
    return { x: rect.right + 6, y: rect.top };
  }, []);

  const visibleReactions = reactions?.filter((r) => r.count > 0) ?? [];

  return (
    <div
      className={cn(
        "group flex items-start gap-3 rounded-lg px-2 py-1.5 hover:bg-white/[0.03]",
        isSelected && "border-l-2 border-rim-accent bg-white/[0.03]",
      )}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e, message.id, message.text ?? "");
      }}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rim-panel-soft text-xs font-medium text-rim-text-muted">
        {authorInitial}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={cn("text-sm font-medium", isCurrentUser ? "text-rim-accent" : "text-white")}>
            {authorName}
          </span>
          <span className="text-xs text-rim-text-faint">
            {formatTime(message.sentAt)}
          </span>
          {message.rootThreadId && (
            <button
              type="button"
              onClick={() => onOpenThread(message.id)}
              className="text-xs text-rim-accent hover:underline"
            >
              thread
            </button>
          )}
        </div>
        <p className="mt-0.5 text-sm text-rim-text">{message.text}</p>

        <div className="mt-1 flex flex-wrap items-center gap-1">
            {visibleReactions.map((reaction) => (
              <ReactionPill
                key={reaction.emoji}
                reaction={reaction}
                messageId={message.id}
                onToggleReaction={onToggleReaction}
                resolveMember={resolveMember}
              />
            ))}

            <button
              ref={btnRef}
              type="button"
              onClick={() => setPickerOpen((prev) => !prev)}
              className="rounded p-1 text-rim-text-faint opacity-0 transition hover:text-rim-accent group-hover:opacity-100"
              title="Add reaction"
              aria-label="Add reaction"
            >
              <SmilePlus className="h-3.5 w-3.5" />
            </button>

            {pickerOpen && (
              <EmojiPicker
                position={getPickerPosition()}
                onSelect={(emoji) => {
                  onToggleReaction(message.id, emoji);
                  setPickerOpen(false);
                }}
                onClose={() => setPickerOpen(false)}
              />
            )}
        </div>
      </div>
      {!message.threadId && !message.rootThreadId && (
        <button
          type="button"
          onClick={() => onOpenThread(message.id)}
          className="rounded p-1 text-rim-text-faint opacity-0 transition hover:text-rim-accent group-hover:opacity-100"
          title="Open thread"
          aria-label="Open thread"
        >
          <MessageSquare className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function ReactionPill({
  reaction,
  messageId,
  onToggleReaction,
  resolveMember,
}: {
  reaction: Reaction;
  messageId: string;
  onToggleReaction: (messageId: string, emoji: string) => void;
  resolveMember?: MemberResolver;
}) {
  const pill = (
    <button
      type="button"
      onClick={() => onToggleReaction(messageId, reaction.emoji)}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition hover:brightness-125",
        reaction.reactedByMe
          ? "border border-rim-accent/40 bg-rim-accent/20 text-rim-accent"
          : "border border-rim-line bg-rim-void text-rim-text-muted",
      )}
    >
      <span>{reaction.emoji}</span>
      <span>{reaction.count}</span>
    </button>
  );

  // If no member resolver or no userIds, render without tooltip
  if (!resolveMember || !reaction.userIds || reaction.userIds.length === 0) {
    return pill;
  }

  // Resolve names, putting current user ("You") first
  const resolved = reaction.userIds.map((uid) => {
    const member = resolveMember(uid);
    return { name: member.displayName, isCurrentUser: member.isCurrentUser };
  });

  // Sort: current user first
  resolved.sort((a, b) => {
    if (a.isCurrentUser && !b.isCurrentUser) return -1;
    if (!a.isCurrentUser && b.isCurrentUser) return 1;
    return 0;
  });

  const names = resolved.map((r) => (r.isCurrentUser ? "You" : r.name));

  const tooltipContent = (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-rim-text-muted">
        <span className="text-base">{reaction.emoji}</span>
        <span>reacted</span>
      </div>
      <div className="mt-1 border-t border-rim-line pt-1">
        {names.slice(0, 6).map((name, i) => (
          <div
            key={`${name}-${i}`}
            className={cn(
              "text-sm",
              resolved[i]?.isCurrentUser ? "text-rim-accent" : "text-rim-text",
            )}
          >
            {name}
          </div>
        ))}
        {reaction.count > Math.min(names.length, 6) && (
          <div className="text-xs text-rim-text-faint">
            and {reaction.count - Math.min(names.length, 6)} others
          </div>
        )}
      </div>
    </div>
  );

  return (
    <HoverTooltip content={tooltipContent}>
      {pill}
    </HoverTooltip>
  );
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" }) + " " +
    date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
