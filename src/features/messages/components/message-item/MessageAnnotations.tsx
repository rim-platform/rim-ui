import { memo } from "react";
import { CornerUpLeft, MessageSquare } from "lucide-react";

import { useThreadReplyCount } from "../../../threads/api/useThreadReplyCount";
import { LinkPreviewCard } from "../LinkPreviewCard";
import type { LinkPreview } from "../LinkPreviewCard";

export const MessageLinkPreviews = memo(function MessageLinkPreviews({
  previews,
}: {
  previews?: LinkPreview[];
}) {
  if (!previews || previews.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {previews.map((preview) => (
        <LinkPreviewCard key={preview.id} preview={preview} />
      ))}
    </div>
  );
});

/** Hover action that starts a timeline reply to the message. */
export const MessageReplyButton = memo(function MessageReplyButton({
  messageId,
  onReply,
}: {
  messageId: string;
  onReply: (messageId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onReply(messageId)}
      className="rounded p-1 text-rim-text-faint opacity-0 transition hover:text-rim-accent group-hover:opacity-100"
      title="Reply"
      aria-label="Reply"
    >
      <CornerUpLeft className="h-4 w-4" />
    </button>
  );
});

/** Hover action that opens the message's thread, starting it when there is none. */
export const MessageThreadButton = memo(function MessageThreadButton({
  messageId,
  onOpenThread,
}: {
  messageId: string;
  onOpenThread: (messageId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpenThread(messageId)}
      className="rounded p-1 text-rim-text-faint opacity-0 transition hover:text-rim-accent group-hover:opacity-100"
      title="Open thread"
      aria-label="Open thread"
    >
      <MessageSquare className="h-4 w-4" />
    </button>
  );
});

/** What the link under a thread's root reads: its reply count when known, else "View thread". */
function threadSummaryLabel(replyCount: number | null): string {
  if (replyCount === null || replyCount <= 0) return "View thread";
  return replyCount === 1 ? "1 reply" : `${replyCount} replies`;
}

/**
 * The link under a thread's root that opens its thread, with the thread's reply count when the
 * server reports it.
 */
export const MessageThreadSummary = memo(function MessageThreadSummary({
  messageId,
  workspaceId,
  conversationId,
  onOpenThread,
}: {
  messageId: string;
  workspaceId?: string;
  conversationId?: string;
  onOpenThread: (messageId: string) => void;
}) {
  const replyCount = useThreadReplyCount(workspaceId, conversationId, messageId, true);
  return (
    <button
      type="button"
      onClick={() => onOpenThread(messageId)}
      className="mt-1 inline-flex items-center gap-1 text-xs text-rim-accent hover:underline"
    >
      <MessageSquare className="h-3 w-3" />
      {threadSummaryLabel(replyCount)}
    </button>
  );
});
