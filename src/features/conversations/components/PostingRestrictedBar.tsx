import { Megaphone } from "lucide-react";

interface PostingRestrictedBarProps {
  /** Replaces a thread's composer rather than the channel's. */
  thread?: boolean;
  /** Whether the viewer may still react and reply in threads, said under the channel's bar. */
  allowsThreads?: boolean;
}

/** Replaces a composer where the channel's posting policy keeps the viewer from writing. */
export function PostingRestrictedBar({
  thread = false,
  allowsThreads = false,
}: PostingRestrictedBarProps) {
  return (
    <div
      data-testid="posting-restricted-bar"
      className="flex items-center gap-3 border-t border-rim-line bg-rim-panel-soft px-4 py-3"
    >
      <Megaphone className="h-4 w-4 shrink-0 text-rim-text-muted" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-sm text-rim-text-muted">
        {thread
          ? "Only the owner and moderators can reply here."
          : "Only the owner and moderators can post in this channel."}
        {!thread && allowsThreads && (
          <span className="text-rim-text-faint"> You can still react and reply in threads.</span>
        )}
      </p>
    </div>
  );
}
