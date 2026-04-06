import { useRef, useState, useCallback, useEffect, memo } from "react";
import { MessageSquare, Pin, SmilePlus, Download, FileIcon, Loader2, AlertCircle, Trash2 } from "lucide-react";

import { Avatar } from "../../../shared/ui/Avatar";
import { EmojiPicker } from "../../../shared/ui/EmojiPicker";
import { HoverTooltip } from "../../../shared/ui/HoverTooltip";
import { UserHoverCard } from "../../../shared/ui/UserHoverCard";
import { UserHoverCardPortal } from "../../../shared/ui/UserHoverCardPortal";
import { MarkdownRenderer } from "../../../shared/ui/MarkdownRenderer";
import { usePresenceStore } from "../../presence/state/usePresenceStore";
import { cn } from "../../../shared/ui/cn";
import { formatTime } from "../../../shared/utils/formatTime";
import type { MessageAttachment } from "../../../core/types/messages";
import type { PresenceStatus } from "../../../shared/ui/Avatar";
import { useDeleteAttachmentMutation } from "../api/useAttachments";
import { toast } from "../../../shared/toast/useToastStore";
import { LinkPreviewCard } from "./LinkPreviewCard";
import type { LinkPreview } from "./LinkPreviewCard";

interface Reaction {
  emoji: string;
  count: number;
  reactedByMe: boolean;
  userIds?: string[];
}

interface MessageItemMessage {
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
  attachments?: MessageAttachment[];
}

type MemberResolver = (userId: string) => {
  displayName: string;
  username?: string;
  isCurrentUser: boolean;
  avatarUrl?: string | null;
  statusText?: string | null;
  role?: string;
  joinedAt?: string;
  bio?: string | null;
};

interface MessageItemProps {
  message: MessageItemMessage;
  authorName: string;
  authorInitial: string;
  authorAvatarUrl?: string | null;
  authorUsername?: string;
  authorStatusText?: string | null;
  authorRole?: string;
  authorJoinedAt?: string;
  authorBio?: string | null;
  authorPresenceStatus?: PresenceStatus | null;
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
  /** userId → displayName map for mention rendering */
  memberDisplayMap?: Map<string, string>;
  /** Link preview metadata for URLs found in this message */
  linkPreviews?: LinkPreview[];
}

export const MessageItem = memo(function MessageItem({
  message,
  authorName,
  authorAvatarUrl,
  authorUsername,
  authorStatusText,
  authorRole,
  authorJoinedAt,
  authorBio,
  authorPresenceStatus,
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
  memberDisplayMap,
  linkPreviews,
}: MessageItemProps) {
  // Subscribe to this author's presence directly — avoids parent re-rendering all messages on any presence change
  const storePresence = usePresenceStore((s) => s.presenceMap[message.authorId]);
  const resolvedPresence: PresenceStatus | null =
    storePresence === "ONLINE" || storePresence === "AWAY" || storePresence === "OFFLINE"
      ? storePresence
      : authorPresenceStatus ?? null;

  const [pickerOpen, setPickerOpen] = useState(false);
  const [editText, setEditText] = useState(message.text ?? "");
  const [mentionCard, setMentionCard] = useState<{ userId: string; rect: DOMRect } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mentionTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleMentionClick = useCallback((userId: string, rect: DOMRect) => {
    clearTimeout(mentionTimerRef.current);
    setMentionCard({ userId, rect });
  }, []);

  const handleMentionHover = useCallback((userId: string, rect: DOMRect) => {
    clearTimeout(mentionTimerRef.current);
    mentionTimerRef.current = setTimeout(() => {
      setMentionCard({ userId, rect });
    }, 400);
  }, []);

  const handleMentionLeave = useCallback(() => {
    clearTimeout(mentionTimerRef.current);
    mentionTimerRef.current = setTimeout(() => {
      setMentionCard(null);
    }, 150);
  }, []);

  const handleMentionCardEnter = useCallback(() => {
    clearTimeout(mentionTimerRef.current);
  }, []);

  const handleMentionCardLeave = useCallback(() => {
    clearTimeout(mentionTimerRef.current);
    mentionTimerRef.current = setTimeout(() => {
      setMentionCard(null);
    }, 150);
  }, []);

  useEffect(() => () => clearTimeout(mentionTimerRef.current), []);

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
      <UserHoverCard
        userId={message.authorId}
        username={authorUsername ?? authorName}
        displayName={authorName}
        avatarUrl={authorAvatarUrl}
        statusText={authorStatusText}
        role={authorRole}
        joinedAt={authorJoinedAt}
        bio={authorBio}
        presenceStatus={resolvedPresence}
        isCurrentUser={isCurrentUser}
      >
        <span className="cursor-pointer">
          <Avatar
            url={authorAvatarUrl}
            name={authorName}
            userId={message.authorId}
            size="md"
          />
        </span>
      </UserHoverCard>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <UserHoverCard
            userId={message.authorId}
            username={authorUsername ?? authorName}
            displayName={authorName}
            avatarUrl={authorAvatarUrl}
            statusText={authorStatusText}
            role={authorRole}
            joinedAt={authorJoinedAt}
            bio={authorBio}
            presenceStatus={resolvedPresence}
            isCurrentUser={isCurrentUser}
          >
            <span className={cn("text-sm font-medium cursor-pointer hover:underline", isCurrentUser ? "text-rim-accent" : "text-rim-text")}>
              {authorName}
            </span>
          </UserHoverCard>
          <span className="text-xs text-rim-text-faint">
            {formatTime(message.sentAt)}
          </span>
          {message.isPinned && (
            <Pin className="h-3 w-3 text-rim-accent" />
          )}
          {message.forwardedFromMessageId && (
            <span className="text-xs text-rim-text-faint">{"\u21AA"} Forwarded</span>
          )}
          {authorStatusText && (
            <span className="text-xs text-rim-text-faint truncate max-w-[160px]">{authorStatusText}</span>
          )}
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
            ) : message.text ? (
              <MarkdownRenderer
                content={message.text}
                className="mt-0.5 text-sm text-rim-text prose-rim"
                memberMap={memberDisplayMap}
                onMentionClick={handleMentionClick}
                onMentionHover={handleMentionHover}
                onMentionLeave={handleMentionLeave}
              />
            ) : !message.attachments?.length ? (
              <p className="mt-0.5 text-sm text-rim-text-faint italic">[empty message]</p>
            ) : null}

            {mentionCard && (() => {
              const member = resolveMember?.(mentionCard.userId);
              const memberDisplayName = member?.displayName ?? mentionCard.userId.slice(0, 8);
              return (
                <UserHoverCardPortal
                  userId={mentionCard.userId}
                  username={member?.username ?? memberDisplayName}
                  displayName={memberDisplayName}
                  avatarUrl={member?.avatarUrl}
                  statusText={member?.statusText}
                  role={member?.role}
                  joinedAt={member?.joinedAt}
                  bio={member?.bio}
                  isCurrentUser={member?.isCurrentUser}
                  anchorRect={mentionCard.rect}
                  onMouseEnter={handleMentionCardEnter}
                  onMouseLeave={handleMentionCardLeave}
                />
              );
            })()}

            {message.attachments && message.attachments.length > 0 && (
              <AttachmentList attachments={message.attachments} hasText={!!message.text} serverId={message.serverId} />
            )}

            {linkPreviews && linkPreviews.length > 0 && (
              <div className="flex flex-col gap-2">
                {linkPreviews.map((preview) => (
                  <LinkPreviewCard key={preview.id} preview={preview} />
                ))}
              </div>
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
}, (prev, next) => {
  // Return true if props are equal (skip re-render)
  if (prev.message.id !== next.message.id) return false;
  if (prev.message.text !== next.message.text) return false;
  if (prev.message.isDeleted !== next.message.isDeleted) return false;
  if (prev.message.isPinned !== next.message.isPinned) return false;
  if (prev.message.sentAt !== next.message.sentAt) return false;
  if (prev.isEditing !== next.isEditing) return false;
  if (prev.editError !== next.editError) return false;
  if (prev.isSelected !== next.isSelected) return false;
  if (prev.authorPresenceStatus !== next.authorPresenceStatus) return false;
  if (prev.authorName !== next.authorName) return false;
  if (prev.authorAvatarUrl !== next.authorAvatarUrl) return false;
  if (prev.authorStatusText !== next.authorStatusText) return false;
  if (prev.isCurrentUser !== next.isCurrentUser) return false;
  // Reactions: compare by length and content
  const prevReactions = prev.reactions;
  const nextReactions = next.reactions;
  if (prevReactions !== nextReactions) {
    if (!prevReactions || !nextReactions) return false;
    if (prevReactions.length !== nextReactions.length) return false;
    for (let i = 0; i < prevReactions.length; i++) {
      const pr = prevReactions[i];
      const nr = nextReactions[i];
      if (pr.emoji !== nr.emoji || pr.count !== nr.count || pr.reactedByMe !== nr.reactedByMe) return false;
    }
  }
  // Attachments
  if (prev.message.attachments !== next.message.attachments) {
    if (!prev.message.attachments || !next.message.attachments) return false;
    if (prev.message.attachments.length !== next.message.attachments.length) return false;
    for (let i = 0; i < prev.message.attachments.length; i++) {
      if (prev.message.attachments[i].status !== next.message.attachments[i].status) return false;
    }
  }
  // Link previews
  if (prev.linkPreviews !== next.linkPreviews) {
    if (!prev.linkPreviews || !next.linkPreviews) return false;
    if (prev.linkPreviews.length !== next.linkPreviews.length) return false;
  }
  if (prev.memberDisplayMap !== next.memberDisplayMap) return false;
  return true;
});

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

const UPLOAD_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

function AttachmentList({ attachments, hasText, serverId }: { attachments: MessageAttachment[]; hasText: boolean; serverId?: string }) {
  const baseUrl = (import.meta.env.VITE_GRAPHQL_ENDPOINT || "http://localhost:8080/api").replace(/\/api$/, "");
  const deleteAttachment = useDeleteAttachmentMutation();

  // Track when we first observed each attachment as uploading for client-side timeout
  const uploadTimestamps = useRef<Map<string, number>>(new Map());
  const [timedOutIds, setTimedOutIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const now = Date.now();
    const uploading: string[] = [];

    for (const att of attachments) {
      const isUploading = att.status === "PENDING_UPLOAD" || att.status === "UPLOADED";
      if (isUploading) {
        if (!uploadTimestamps.current.has(att.id)) {
          uploadTimestamps.current.set(att.id, now);
        }
        uploading.push(att.id);
      } else {
        uploadTimestamps.current.delete(att.id);
      }
    }

    if (uploading.length === 0) return;

    // Calculate earliest timeout
    let earliest = Infinity;
    for (const id of uploading) {
      const started = uploadTimestamps.current.get(id) ?? now;
      const remaining = UPLOAD_TIMEOUT_MS - (now - started);
      if (remaining <= 0) {
        // Already timed out
        setTimedOutIds((prev) => {
          if (prev.has(id)) return prev;
          const next = new Set(prev);
          next.add(id);
          return next;
        });
      } else {
        earliest = Math.min(earliest, remaining);
      }
    }

    if (earliest === Infinity) return;

    const timer = setTimeout(() => {
      const checkTime = Date.now();
      setTimedOutIds((prev) => {
        const next = new Set(prev);
        for (const id of uploading) {
          const started = uploadTimestamps.current.get(id);
          if (started && checkTime - started >= UPLOAD_TIMEOUT_MS) {
            next.add(id);
          }
        }
        return next.size !== prev.size ? next : prev;
      });
    }, earliest);

    return () => clearTimeout(timer);
  }, [attachments]);

  function handleDelete(attachmentId: string) {
    if (!serverId) return;
    deleteAttachment.mutate(
      { attachmentId, serverId },
      {
        onError: () => toast.error("Failed to remove attachment"),
      },
    );
  }

  return (
    <div className={cn("flex flex-col gap-2", hasText ? "mt-2" : "mt-0.5")}>
      {attachments.map((att) => {
          const isUploading = (att.status === "PENDING_UPLOAD" || att.status === "UPLOADED") && !timedOutIds.has(att.id);
          const isFailed = att.status === "FAILED" || timedOutIds.has(att.id);
          const canDownload = att.status === "READY";
          const downloadUrl = `${baseUrl}/api/attachments/${att.id}/download`;
          const isImage = att.contentType.startsWith("image/");

          if (isImage) {
            return (
              <div key={att.id} className="relative inline-block">
                <a
                  href={canDownload ? downloadUrl : undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(!canDownload && "pointer-events-none")}
                >
                  <img
                    src={canDownload ? downloadUrl : undefined}
                    alt={att.filename}
                    className={cn(
                      "max-h-64 max-w-md rounded-lg object-contain",
                      (isUploading || isFailed) && "opacity-60",
                    )}
                  />
                </a>
                {isUploading && (
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-rim-text-faint">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>Uploading...</span>
                  </div>
                )}
                {isFailed && (
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-rim-danger">
                    <AlertCircle className="h-3 w-3" />
                    <span>Upload failed</span>
                    {serverId && (
                      <button
                        type="button"
                        onClick={() => handleDelete(att.id)}
                        className="ml-1 rounded p-0.5 text-rim-danger transition hover:bg-rim-danger/10"
                        title="Remove attachment"
                        aria-label="Remove failed attachment"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          }

          return (
            <div key={att.id}>
              <div className="flex items-center gap-1">
                <a
                  href={canDownload ? downloadUrl : undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition",
                    isFailed
                      ? "border-rim-danger/30 bg-rim-panel text-rim-text opacity-60 pointer-events-none"
                      : "border-rim-line bg-rim-panel text-rim-text hover:bg-white/5",
                    isUploading && "opacity-60 pointer-events-none",
                  )}
                >
                  <FileIcon className="h-4 w-4 shrink-0 text-rim-text-muted" />
                  <span className="truncate">{att.filename}</span>
                  <span className="shrink-0 text-xs text-rim-text-faint">{formatFileSize(att.sizeBytes)}</span>
                  {isUploading ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 text-rim-text-muted animate-spin" />
                  ) : isFailed ? (
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 text-rim-danger" />
                  ) : (
                    <Download className="h-3.5 w-3.5 shrink-0 text-rim-text-muted" />
                  )}
                </a>
                {isFailed && serverId && (
                  <button
                    type="button"
                    onClick={() => handleDelete(att.id)}
                    className="rounded p-1.5 text-rim-danger transition hover:bg-rim-danger/10"
                    title="Remove attachment"
                    aria-label="Remove failed attachment"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {isUploading && (
                <span className="mt-0.5 block text-xs text-rim-text-faint">Uploading...</span>
              )}
              {isFailed && (
                <span className="mt-0.5 block text-xs text-rim-danger">Upload failed</span>
              )}
            </div>
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

