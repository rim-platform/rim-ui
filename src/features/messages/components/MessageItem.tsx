import { memo, useCallback } from "react";

import { cn } from "../../../shared/ui/cn";
import { areMessageItemPropsEqual } from "./message-item/areMessageItemPropsEqual";
import { formatShortTime } from "./message-item/formatShortTime";
import { MessageLinkPreviews, MessageThreadButton } from "./message-item/MessageAnnotations";
import { MessageAttachments } from "./message-item/MessageAttachments";
import { EncryptedAttachments } from "../../e2ee/components/EncryptedAttachments";
import { DeletedMessageText, MessageContent, MessageText } from "./message-item/MessageBody";
import { MessageEditForm } from "./message-item/MessageEditForm";
import { MessageAvatar, MessageHeader } from "./message-item/MessageHeader";
import { MessageReactions } from "./message-item/MessageReactions";
import { ReplyQuote } from "./message-item/ReplyQuote";
import type { MessageTextVariant } from "./message-item/MessageBody";
import type { MessageItemProps } from "./message-item/types";

export type {
  MessageAuthorView,
  MessageItemHandlers,
  MessageItemMessage,
  MessageItemProps,
  MessageMembers,
  MessageViewModel,
} from "./message-item/types";

/**
 * One timeline row. Layout only: every piece (header, body, edit form,
 * attachments, reactions, hover actions) is its own memoized component under
 * `message-item/`. Takes a plain view model plus a shared, stable handlers
 * object; see `areMessageItemPropsEqual` for the memo contract.
 */
export const MessageItem = memo(function MessageItem({
  view,
  handlers,
  members,
}: MessageItemProps) {
  const {
    message,
    author,
    replyTo,
    isSelected,
    isHighlighted,
    isDeleteConfirming,
    isEditing = false,
    editError,
    isGrouped = false,
    isFirstInGroup = true,
    displayDensity = "comfortable",
  } = view;
  const { onContextMenu, onOpenThread, onToggleReaction, onSaveEdit, onCancelEdit } = handlers;

  const isDeleted = message.isDeleted === true;
  const encrypted = Boolean(message.e2ee || message.encryption);
  // Decrypted but breaking a rule: never show what it says.
  const unverifiable = message.e2ee?.status === "invalid";
  const isUltraCompact = displayDensity === "ultra-compact";
  const isCompact = displayDensity === "compact";
  const hideAvatar = isUltraCompact || (isGrouped && !isFirstInGroup);
  const hideAuthorLine = isGrouped && !isFirstInGroup;
  const hasAttachments = (message.attachments?.length ?? 0) > 0;

  const messageId = message.id;
  const messageText = message.text ?? "";
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (!isDeleted) onContextMenu?.(e, messageId, messageText);
    },
    [isDeleted, onContextMenu, messageId, messageText],
  );

  const textProps = (variant: MessageTextVariant) => ({
    text: unverifiable ? `*A message from ${author.name} could not be verified*` : message.text,
    hasAttachments,
    variant,
    memberDisplayMap: members?.displayMap,
    resolveMember: members?.resolve,
  });

  const extras = (
    <>
      {hasAttachments &&
        (message.e2ee && message.serverId && message.conversationId ? (
          <EncryptedAttachments
            messageId={messageId}
            serverId={message.serverId}
            conversationId={message.conversationId}
            attachments={message.attachments ?? []}
            hasText={!!message.text}
          />
        ) : (
          <MessageAttachments
            attachments={message.attachments ?? []}
            hasText={!!message.text}
            serverId={message.serverId}
          />
        ))}
      <MessageLinkPreviews previews={message.linkPreviews} />
      <MessageReactions
        messageId={messageId}
        serverId={message.serverId}
        reactions={message.reactions}
        onToggleReaction={onToggleReaction}
        resolveMember={members?.resolve}
      />
    </>
  );

  const replyQuote =
    replyTo && !isDeleted ? <ReplyQuote quote={replyTo} onJump={handlers.onJumpToMessage} /> : null;

  const threadButton =
    !isDeleted && !message.threadId && !message.rootThreadId ? (
      <MessageThreadButton messageId={messageId} onOpenThread={onOpenThread} />
    ) : null;

  const rowProps = {
    id: `message-${messageId}`,
    "data-message-id": messageId,
    role: "option",
    "aria-selected": isSelected,
    onContextMenu: handleContextMenu,
  } as const;
  const stateClasses = [
    isSelected && "border-l-2 border-rim-accent bg-rim-accent/5",
    isDeleteConfirming && "border-l-2 border-rim-danger bg-rim-danger/10",
    isHighlighted && "bg-rim-accent/10",
  ];

  // --- Ultra-compact: IRC-style single line ---
  if (isUltraCompact) {
    return (
      <div
        {...rowProps}
        className={cn(
          "group flex items-baseline gap-1.5 rounded px-2 py-0.5 transition-colors hover:bg-white/[0.03]",
          ...stateClasses,
        )}
      >
        <span className="shrink-0 text-xs text-rim-text-faint">
          {formatShortTime(message.sentAt)}
        </span>
        {!hideAuthorLine && (
          <span className="shrink-0 text-sm font-semibold text-rim-accent">{author.name}:</span>
        )}
        {isDeleted ? (
          <DeletedMessageText variant="inline" />
        ) : isEditing ? (
          <div className="min-w-0 flex-1">
            <MessageEditForm
              messageId={messageId}
              initialText={messageText}
              editError={editError}
              onSaveEdit={onSaveEdit}
              onCancelEdit={onCancelEdit}
            />
          </div>
        ) : (
          <div className="min-w-0 flex-1">
            {replyQuote}
            <MessageText {...textProps("inline")} />
            {extras}
          </div>
        )}
        {threadButton}
      </div>
    );
  }

  // --- Comfortable and Compact modes ---
  const contentProps = {
    messageId,
    isDeleted,
    isEditing,
    editError,
    onSaveEdit,
    onCancelEdit,
  };

  return (
    <div
      {...rowProps}
      className={cn(
        "group flex items-start gap-3 rounded-lg px-2 transition-colors hover:bg-white/[0.03]",
        isCompact ? "py-1" : "py-1.5",
        ...stateClasses,
      )}
    >
      {hideAvatar ? (
        // Preserve alignment: invisible placeholder matching avatar width
        <div className={cn("shrink-0", isCompact ? "w-6" : "w-10")} />
      ) : (
        <MessageAvatar authorId={message.authorId} author={author} compact={isCompact} />
      )}
      <div className="min-w-0 flex-1">
        {hideAuthorLine ? (
          // Grouped continuation: inline timestamp prefix (compact) or on hover (comfortable)
          isCompact ? (
            <div className="flex items-baseline gap-1.5">
              <span className="shrink-0 text-xs text-rim-text-faint">
                {formatShortTime(message.sentAt)}
              </span>
              <div className="min-w-0 flex-1">
                {replyQuote}
                <MessageContent {...contentProps} {...textProps("compact")} />
              </div>
            </div>
          ) : (
            <div className="relative">
              <span className="absolute -left-12 top-0.5 text-xs text-rim-text-faint opacity-0 transition-opacity group-hover:opacity-100">
                {formatShortTime(message.sentAt)}
              </span>
              {replyQuote}
              <MessageContent {...contentProps} {...textProps("grouped")} />
            </div>
          )
        ) : (
          // First in group or ungrouped: full header
          <>
            <MessageHeader
              messageId={messageId}
              authorId={message.authorId}
              author={author}
              sentAt={message.sentAt}
              isPinned={message.isPinned}
              isDeleted={isDeleted}
              rootThreadId={message.rootThreadId}
              forwardedFromMessageId={message.forwardedFromMessageId}
              forwardedFrom={message.forwardedFrom}
              encrypted={encrypted}
              beforeEncryption={message.beforeEncryption}
              onOpenThread={onOpenThread}
              onNavigateToForwardedSource={handlers.onNavigateToForwardedSource}
            />
            {replyQuote}
            <MessageContent {...contentProps} {...textProps("full")} />
          </>
        )}
        {!isDeleted && extras}
      </div>
      {threadButton}
    </div>
  );
}, areMessageItemPropsEqual);
