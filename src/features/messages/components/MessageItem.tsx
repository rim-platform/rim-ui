import { useRef, useState, useCallback, useEffect } from "react";
import { MessageSquare, SmilePlus, Download, FileIcon } from "lucide-react";

import { Avatar } from "../../../shared/ui/Avatar";
import { EmojiPicker } from "../../../shared/ui/EmojiPicker";
import { HoverTooltip } from "../../../shared/ui/HoverTooltip";
import { MarkdownRenderer } from "../../../shared/ui/MarkdownRenderer";
import { cn } from "../../../shared/ui/cn";
import type { MessageAttachment } from "../../../core/types/messages";

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
  isDeleted?: boolean;
  attachments?: MessageAttachment[];
}

type MemberResolver = (userId: string) => { displayName: string; isCurrentUser: boolean };

interface MessageItemProps {
  message: MessageItemMessage;
  authorName: string;
  authorInitial: string;
  authorAvatarUrl?: string | null;
  isCurrentUser: boolean;
  reactions?: Reaction[];
  isSelected?: boolean;
  isEditing?: boolean;
  editError?: boolean;
  onOpenThread: (messageId: string) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onContextMenu: (event: React.MouseEvent, messageId: string, messageText: string) => void;
  onSaveEdit?: (messageId: string, newText: string) => void;
  onCancelEdit?: () => void;
  resolveMember?: MemberResolver;
}

export function MessageItem({
  message,
  authorName,
  authorAvatarUrl,
  isCurrentUser,
  reactions,
  isSelected,
  isEditing,
  editError,
  onOpenThread,
  onToggleReaction,
  onContextMenu,
  onSaveEdit,
  onCancelEdit,
  resolveMember,
}: MessageItemProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editText, setEditText] = useState(message.text ?? "");
  const btnRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset edit text and focus textarea when entering edit mode
  useEffect(() => {
    if (isEditing) {
      setEditText(message.text ?? "");
      // Focus on next tick so the textarea is rendered
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (ta) {
          ta.focus();
          ta.setSelectionRange(ta.value.length, ta.value.length);
        }
      });
    }
  }, [isEditing, message.text]);

  const handleEditKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancelEdit?.();
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const trimmed = editText.trim();
        if (trimmed && trimmed !== message.text) {
          onSaveEdit?.(message.id, trimmed);
        } else {
          onCancelEdit?.();
        }
      }
    },
    [editText, message.id, message.text, onSaveEdit, onCancelEdit],
  );

  const getPickerPosition = useCallback(() => {
    if (!btnRef.current) return { x: 0, y: 0 };
    const rect = btnRef.current.getBoundingClientRect();
    return { x: rect.right + 6, y: rect.top };
  }, []);

  const visibleReactions = reactions?.filter((r) => r.count > 0) ?? [];
  const isDeleted = message.isDeleted === true;

  return (
    <div
      data-message-id={message.id}
      className={cn(
        "group flex items-start gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/[0.03]",
        isSelected && "border-l-2 border-rim-accent bg-white/[0.03]",
      )}
      onContextMenu={(e) => {
        e.preventDefault();
        if (!isDeleted) {
          onContextMenu(e, message.id, message.text ?? "");
        }
      }}
    >
      <Avatar
        url={authorAvatarUrl}
        name={authorName}
        userId={message.authorId}
        size="md"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={cn("text-sm font-medium", isCurrentUser ? "text-rim-accent" : "text-rim-text")}>
            {authorName}
          </span>
          <span className="text-xs text-rim-text-faint">
            {formatTime(message.sentAt)}
          </span>
          {!isDeleted && message.rootThreadId && (
            <button
              type="button"
              onClick={() => onOpenThread(message.id)}
              className="text-xs text-rim-accent hover:underline"
            >
              thread
            </button>
          )}
        </div>
        {isDeleted ? (
          <p className="mt-0.5 text-sm italic text-rim-text-faint">This message was deleted</p>
        ) : (
          <>
            {isEditing ? (
              <div className="mt-0.5">
                <textarea
                  ref={textareaRef}
                  className="w-full resize-none rounded border border-rim-line bg-rim-panel px-2 py-1 text-sm text-rim-text outline-none focus:border-rim-accent"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={handleEditKeyDown}
                  rows={Math.max(1, editText.split("\n").length)}
                />
                <div className="mt-1 flex gap-2">
                  <button
                    type="button"
                    className="rounded bg-rim-accent px-2 py-0.5 text-xs text-rim-text transition hover:brightness-110"
                    onClick={() => {
                      const trimmed = editText.trim();
                      if (trimmed && trimmed !== message.text) {
                        onSaveEdit?.(message.id, trimmed);
                      } else {
                        onCancelEdit?.();
                      }
                    }}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="rounded px-2 py-0.5 text-xs text-rim-text-muted transition hover:text-rim-text"
                    onClick={() => onCancelEdit?.()}
                  >
                    Cancel
                  </button>
                  <span className="text-xs text-rim-text-faint leading-5">
                    Enter to save &middot; Esc to cancel
                  </span>
                </div>
                {editError && (
                  <p className="mt-1 text-xs text-rim-danger">Failed to save. Try again.</p>
                )}
              </div>
            ) : (
              <MarkdownRenderer
                content={message.text ?? ""}
                className="mt-0.5 text-sm text-rim-text prose-rim"
              />
            )}

            {message.attachments && message.attachments.length > 0 && (
              <AttachmentList attachments={message.attachments} />
            )}

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
          </>
        )}
      </div>
      {!isDeleted && !message.threadId && !message.rootThreadId && (
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

function AttachmentList({ attachments }: { attachments: MessageAttachment[] }) {
  const baseUrl = (import.meta.env.VITE_GRAPHQL_ENDPOINT || "http://localhost:8080/api").replace(/\/api$/, "");

  return (
    <div className="mt-2 flex flex-col gap-2">
      {attachments
        .filter((a) => a.status === "READY")
        .map((att) => {
          const downloadUrl = `${baseUrl}/api/files/${att.id}`;
          const isImage = att.contentType.startsWith("image/");

          if (isImage) {
            return (
              <a
                key={att.id}
                href={downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <img
                  src={downloadUrl}
                  alt={att.filename}
                  className="max-h-64 max-w-md rounded-lg object-contain"
                />
              </a>
            );
          }

          return (
            <a
              key={att.id}
              href={downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-rim-line bg-rim-panel px-3 py-2 text-sm text-rim-text transition hover:bg-white/5"
            >
              <FileIcon className="h-4 w-4 shrink-0 text-rim-text-muted" />
              <span className="truncate">{att.filename}</span>
              <span className="shrink-0 text-xs text-rim-text-faint">{formatFileSize(att.sizeBytes)}</span>
              <Download className="h-3.5 w-3.5 shrink-0 text-rim-text-muted" />
            </a>
          );
        })}
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
