import { memo, useCallback, useEffect, useRef, useState } from "react";

import { activeBan } from "../../hooks/useBanExpiry";
import { MarkdownRenderer } from "../../../../shared/ui/MarkdownRenderer";
import { useMessageEmojiMap } from "../../../emoji/hooks/useMessageEmojiMap";
import { UserHoverCardPortal } from "../../../../shared/ui/UserHoverCardPortal";
import { openDirectWithMember } from "../../../conversations/state/openDirect";
import { useMessageDisplaySettingsStore } from "../../state/useMessageDisplaySettingsStore";
import { MessageEditForm } from "./MessageEditForm";
import type { MemberResolver, MessageItemHandlers } from "./types";

/** Class sets per layout; kept verbatim from the pre-split row so density modes look identical. */
const TEXT_STYLES = {
  inline: {
    markdown: "inline text-sm text-rim-text prose-rim",
    empty: "text-sm text-rim-text-faint italic",
    deleted: "text-sm italic text-rim-text-faint",
  },
  compact: {
    markdown: "text-sm text-rim-text prose-rim",
    empty: "text-sm text-rim-text-faint italic",
    deleted: "text-sm italic text-rim-text-faint",
  },
  grouped: {
    markdown: "mt-0.5 text-sm text-rim-text prose-rim",
    empty: "mt-0.5 text-sm text-rim-text-faint italic",
    deleted: "text-sm italic text-rim-text-faint",
  },
  full: {
    markdown: "mt-0.5 text-sm text-rim-text prose-rim",
    empty: "mt-0.5 text-sm text-rim-text-faint italic",
    deleted: "mt-0.5 text-sm italic text-rim-text-faint",
  },
} as const;

export type MessageTextVariant = keyof typeof TEXT_STYLES;

interface MessageTextProps {
  text?: string | null;
  hasAttachments: boolean;
  variant: MessageTextVariant;
  memberDisplayMap?: Map<string, string>;
  resolveMember?: MemberResolver;
  onMentionContextMenu?: MessageItemHandlers["onMentionContextMenu"];
  /** The workspace whose custom emoji the text may name. */
  workspaceId?: string | null;
}

/**
 * Markdown body (DOMPurify-sanitised by MarkdownRenderer) plus the mention hover card. A right
 * click or the ContextMenu key on a mention opens the mentioned person's menu.
 */
export const MessageText = memo(function MessageText({
  text,
  hasAttachments,
  variant,
  memberDisplayMap,
  resolveMember,
  onMentionContextMenu,
  workspaceId,
}: MessageTextProps) {
  const showInlineMedia = useMessageDisplaySettingsStore((s) => s.showInlineMedia);
  const customEmojiMap = useMessageEmojiMap(text, workspaceId);
  const [mentionCard, setMentionCard] = useState<{ userId: string; rect: DOMRect } | null>(null);
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

  const scheduleMentionClose = useCallback(() => {
    clearTimeout(mentionTimerRef.current);
    mentionTimerRef.current = setTimeout(() => {
      setMentionCard(null);
    }, 150);
  }, []);

  const handleMentionCardEnter = useCallback(() => {
    clearTimeout(mentionTimerRef.current);
  }, []);

  useEffect(() => () => clearTimeout(mentionTimerRef.current), []);

  const styles = TEXT_STYLES[variant];
  const EmptyTag = variant === "inline" ? "span" : "p";

  let mentionCardBlock: React.ReactNode = null;
  if (mentionCard) {
    const member = resolveMember?.(mentionCard.userId);
    const memberDisplayName =
      member?.displayName || memberDisplayMap?.get(mentionCard.userId) || "Former member";
    mentionCardBlock = (
      <UserHoverCardPortal
        isFormerMember={member?.isFormerMember}
        ban={member?.ban}
        userId={mentionCard.userId}
        username={member?.username ?? memberDisplayName}
        handle={member?.handleView}
        displayName={memberDisplayName}
        avatarUrl={member?.avatarUrl}
        statusText={member?.statusText}
        role={member?.role}
        joinedAt={member?.joinedAt}
        bio={member?.bio}
        isCurrentUser={member?.isCurrentUser}
        onSendDm={
          member?.isFormerMember || activeBan(member?.ban)
            ? undefined
            : () => void openDirectWithMember(mentionCard.userId)
        }
        anchorRect={mentionCard.rect}
        onMouseEnter={handleMentionCardEnter}
        onMouseLeave={scheduleMentionClose}
      />
    );
  }

  return (
    <>
      {text ? (
        <MarkdownRenderer
          content={text}
          className={styles.markdown}
          memberMap={memberDisplayMap}
          customEmojiMap={customEmojiMap}
          onMentionClick={handleMentionClick}
          onMentionHover={handleMentionHover}
          onMentionLeave={scheduleMentionClose}
          onMentionContextMenu={(id, element, event) => {
            if (!resolveMember?.(id).isFormerMember && !activeBan(resolveMember?.(id).ban))
              onMentionContextMenu?.(id, element, event);
          }}
          showInlineMedia={showInlineMedia}
        />
      ) : !hasAttachments ? (
        <EmptyTag className={styles.empty}>[empty message]</EmptyTag>
      ) : null}
      {mentionCardBlock}
    </>
  );
});

export function DeletedMessageText({ variant }: { variant: MessageTextVariant }) {
  const Tag = variant === "inline" ? "span" : "p";
  return <Tag className={TEXT_STYLES[variant].deleted}>This message was deleted</Tag>;
}

interface MessageContentProps extends MessageTextProps {
  messageId: string;
  isDeleted: boolean;
  isEditing: boolean;
  editError?: boolean;
  onSaveEdit?: (messageId: string, newText: string) => void;
  onCancelEdit?: () => void;
}

/** Deleted placeholder, edit form, or rendered text, whichever applies. */
export function MessageContent({
  messageId,
  isDeleted,
  isEditing,
  editError,
  onSaveEdit,
  onCancelEdit,
  ...textProps
}: MessageContentProps) {
  if (isDeleted) return <DeletedMessageText variant={textProps.variant} />;
  if (isEditing) {
    return (
      <MessageEditForm
        messageId={messageId}
        initialText={textProps.text ?? ""}
        editError={editError}
        onSaveEdit={onSaveEdit}
        onCancelEdit={onCancelEdit}
      />
    );
  }
  return <MessageText {...textProps} />;
}
