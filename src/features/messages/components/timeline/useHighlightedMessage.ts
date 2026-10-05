import { useEffect } from "react";

import { useShellStore } from "../../../../shell/state/useShellStore";

const HIGHLIGHT_MS = 1500;

interface UseHighlightedMessageOptions {
  items: { id: string }[];
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  scrollToIndex: (index: number, align?: "auto" | "center") => void;
}

/**
 * Jump to the message a search result or forwarded-message link points at:
 * scroll its (possibly unmounted) row to the centre, flash it, then clear the
 * request. Returns the id to render as highlighted.
 */
export function useHighlightedMessage({
  items,
  scrollContainerRef,
  scrollToIndex,
}: UseHighlightedMessageOptions): string | null {
  const highlightedMessageId = useShellStore((s) => s.highlightedMessageId);
  const setHighlightedMessageId = useShellStore((s) => s.setHighlightedMessageId);

  useEffect(() => {
    if (!highlightedMessageId || !scrollContainerRef.current) return;
    if (!/^[\w-]+$/.test(highlightedMessageId)) {
      setHighlightedMessageId(null);
      return;
    }
    const index = items.findIndex((m) => m.id === highlightedMessageId);
    if (index < 0) {
      setHighlightedMessageId(null);
      return;
    }
    scrollToIndex(index, "center");
    const timer = setTimeout(() => setHighlightedMessageId(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlightedMessageId, setHighlightedMessageId, items, scrollContainerRef, scrollToIndex]);

  return highlightedMessageId;
}
