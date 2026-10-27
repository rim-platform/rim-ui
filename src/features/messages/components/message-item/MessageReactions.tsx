import { memo, useCallback, useRef, useState } from "react";
import { SmilePlus } from "lucide-react";

import { EmojiPicker } from "../../../../shared/ui/EmojiPicker";
import { HoverTooltip } from "../../../../shared/ui/HoverTooltip";
import { cn } from "../../../../shared/ui/cn";
import { useCustomEmojis } from "../../../emoji/api/useCustomEmojis";
import { useMessageEmojiMap } from "../../../emoji/hooks/useMessageEmojiMap";
import type { MemberResolver, Reaction } from "./types";

interface MessageReactionsProps {
  messageId: string;
  serverId?: string;
  reactions?: Reaction[];
  onToggleReaction: (messageId: string, emoji: string) => void;
  /** Whether the viewer may add reactions; when false only their own pills toggle (off). */
  canAddReaction?: boolean;
  resolveMember?: MemberResolver;
  /**
   * Where it renders: `"row"` is the line of pills under the text with the add button after
   * them; `"action"` is the add button alone, for the row's hover actions.
   */
  placement?: "row" | "action";
}

/**
 * Reaction pills plus the hover "add reaction" button and its emoji picker, or the add button
 * alone when `placement` is `"action"`.
 */
export const MessageReactions = memo(function MessageReactions({
  messageId,
  serverId,
  reactions,
  onToggleReaction,
  canAddReaction = true,
  resolveMember,
  placement = "row",
}: MessageReactionsProps) {
  const shortcodes =
    placement === "row"
      ? (reactions ?? [])
          .filter((r) => r.count > 0)
          .map((r) => r.emoji)
          .join(" ")
      : null;
  const customEmoji = useMessageEmojiMap(shortcodes, serverId);
  const addButton = canAddReaction ? (
    <AddReactionButton
      messageId={messageId}
      serverId={serverId}
      onToggleReaction={onToggleReaction}
    />
  ) : null;

  if (placement === "action") return addButton;

  const visibleReactions = reactions?.filter((r) => r.count > 0) ?? [];

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {visibleReactions.map((reaction) => (
        <ReactionPill
          key={reaction.emoji}
          reaction={reaction}
          messageId={messageId}
          onToggleReaction={onToggleReaction}
          readOnly={!canAddReaction && !reaction.reactedByMe}
          resolveMember={resolveMember}
          imageSrc={customEmoji?.get(/^:([a-zA-Z0-9_-]+):$/.exec(reaction.emoji)?.[1] ?? "")}
        />
      ))}
      {addButton}
    </div>
  );
});

/** The hover "Add reaction" button and the emoji picker it opens beside itself. */
function AddReactionButton({
  messageId,
  serverId,
  onToggleReaction,
}: {
  messageId: string;
  serverId?: string;
  onToggleReaction: (messageId: string, emoji: string) => void;
}) {
  const { emojis: customEmojis } = useCustomEmojis(serverId ?? null);
  // Picker anchor, captured from the button when it opens; null when closed.
  const [pickerPosition, setPickerPosition] = useState<{ x: number; y: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const togglePicker = useCallback(() => {
    const rect = btnRef.current?.getBoundingClientRect();
    const anchor = rect ? { x: rect.right + 6, y: rect.top } : { x: 0, y: 0 };
    setPickerPosition((prev) => (prev ? null : anchor));
  }, []);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={togglePicker}
        className="rounded p-1 text-rim-text-faint opacity-0 transition hover:text-rim-accent group-hover:opacity-100"
        title="Add reaction"
        aria-label="Add reaction"
      >
        <SmilePlus className="h-3.5 w-3.5" />
      </button>
      {pickerPosition && (
        <EmojiPicker
          position={pickerPosition}
          customEmojis={customEmojis}
          onSelect={(emoji) => {
            onToggleReaction(messageId, emoji);
            setPickerPosition(null);
          }}
          onClose={() => setPickerPosition(null)}
        />
      )}
    </>
  );
}

/** A reaction's emoji: the image of a custom one, else the text. */
function ReactionEmoji({
  emoji,
  src,
  className,
}: {
  emoji: string;
  src?: string;
  className?: string;
}) {
  return src ? (
    <img
      src={src}
      alt={emoji}
      title={emoji}
      className={cn("inline-block object-contain", className)}
    />
  ) : (
    <span className={className}>{emoji}</span>
  );
}

function ReactionPill({
  reaction,
  messageId,
  onToggleReaction,
  readOnly,
  resolveMember,
  imageSrc,
}: {
  reaction: Reaction;
  messageId: string;
  onToggleReaction: (messageId: string, emoji: string) => void;
  /** Shows the count without toggling it. */
  readOnly: boolean;
  resolveMember?: MemberResolver;
  /** The image of a custom emoji reaction, once it has loaded. */
  imageSrc?: string;
}) {
  const pill = (
    <button
      type="button"
      aria-disabled={readOnly || undefined}
      onClick={readOnly ? undefined : () => onToggleReaction(messageId, reaction.emoji)}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition",
        readOnly ? "cursor-default" : "hover:brightness-125",
        reaction.reactedByMe
          ? "border border-rim-accent/40 bg-rim-accent/20 text-rim-accent"
          : "border border-rim-line bg-rim-void text-rim-text-muted",
      )}
    >
      <ReactionEmoji emoji={reaction.emoji} src={imageSrc} className="h-4 w-4" />
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
  resolved.sort((a, b) => {
    if (a.isCurrentUser && !b.isCurrentUser) return -1;
    if (!a.isCurrentUser && b.isCurrentUser) return 1;
    return 0;
  });
  const names = resolved.map((r) => (r.isCurrentUser ? "You" : r.name));

  const tooltipContent = (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-rim-text-muted">
        <ReactionEmoji emoji={reaction.emoji} src={imageSrc} className="h-5 w-5 text-base" />
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

  return <HoverTooltip content={tooltipContent}>{pill}</HoverTooltip>;
}
