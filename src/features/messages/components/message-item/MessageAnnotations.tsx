import { memo } from "react";
import { MessageSquare } from "lucide-react";

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

/** The link under a thread's root that opens its thread. */
export const MessageThreadSummary = memo(function MessageThreadSummary({
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
      className="mt-1 inline-flex items-center gap-1 text-xs text-rim-accent hover:underline"
    >
      <MessageSquare className="h-3 w-3" />
      View thread
    </button>
  );
});
