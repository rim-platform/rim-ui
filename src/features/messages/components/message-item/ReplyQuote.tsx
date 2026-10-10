import { memo } from "react";
import { CornerUpLeft } from "lucide-react";

import type { ReplyQuoteView } from "./types";

interface ReplyQuoteProps {
  quote: ReplyQuoteView;
  onJump?: (messageId: string) => void;
}

/**
 * The compact quote above a reply: the parent's author and first line, styled like a Markdown
 * blockquote. Activating it jumps to the parent.
 */
export const ReplyQuote = memo(function ReplyQuote({ quote, onJump }: ReplyQuoteProps) {
  const label = quote.authorName
    ? `Reply to ${quote.authorName}: ${quote.excerpt}. Jump to the original message`
    : "Reply to a message. Jump to the original message";
  return (
    <button
      type="button"
      onClick={() => onJump?.(quote.messageId)}
      aria-label={label}
      data-reply-quote={quote.messageId}
      className="mb-1 flex max-w-full items-center gap-1.5 rounded-r-md border-l-[3px] border-rim-accent/45 bg-rim-panel-soft px-2 py-0.5 text-left text-xs text-rim-text-muted transition hover:text-rim-text"
    >
      <CornerUpLeft className="h-3 w-3 shrink-0 text-rim-text-faint" aria-hidden />
      {quote.authorName && (
        <span className="shrink-0 font-medium text-rim-text">{quote.authorName}</span>
      )}
      <span className="min-w-0 truncate">{quote.excerpt}</span>
    </button>
  );
});
