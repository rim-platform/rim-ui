import { useLayoutEffect, useRef } from "react";

import { useMessageFoldStore } from "../../state/useMessageFoldStore";

/** Text taller than this folds. */
export const FOLD_AFTER_PX = 320;
/** How much of a folded text shows. */
export const FOLDED_HEIGHT_PX = 200;

/** Fades the bottom of a folded text out. */
const FADE = "linear-gradient(to bottom, black calc(100% - 48px), transparent)";

interface FoldableTextProps {
  messageId: string;
  /** Called before the fold changes; `expanding` is true for Show more. */
  onToggle?: (messageId: string, expanding: boolean) => void;
  /** Classes for the inner block that holds the text (the ultra-compact row's edited-mark rule). */
  innerClassName?: string;
  children: React.ReactNode;
}

/**
 * A message's text, clipped to its first lines with Show more under it when it renders taller
 * than {@link FOLD_AFTER_PX}; Show less folds it again. The whole text stays in the DOM.
 */
export function FoldableText({ messageId, onToggle, innerClassName, children }: FoldableTextProps) {
  const innerRef = useRef<HTMLDivElement>(null);
  const setFoldable = useMessageFoldStore((s) => s.setFoldable);
  const toggleExpanded = useMessageFoldStore((s) => s.toggleExpanded);
  const foldable = useMessageFoldStore((s) => s.foldable.has(messageId));
  const expanded = useMessageFoldStore((s) => s.expanded.has(messageId));
  const folded = foldable && !expanded;

  useLayoutEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    const measure = () => setFoldable(messageId, inner.offsetHeight > FOLD_AFTER_PX);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [messageId, setFoldable]);

  const toggle = () => {
    onToggle?.(messageId, !expanded);
    toggleExpanded(messageId);
  };

  return (
    <div data-foldable-text="">
      <div
        style={
          folded
            ? {
                maxHeight: FOLDED_HEIGHT_PX,
                overflow: "hidden",
                maskImage: FADE,
                WebkitMaskImage: FADE,
              }
            : undefined
        }
      >
        <div ref={innerRef} className={innerClassName}>
          {children}
        </div>
      </div>
      {foldable && (
        <button
          type="button"
          aria-expanded={expanded}
          className="mt-0.5 text-xs font-medium text-rim-accent hover:underline"
          onClick={toggle}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
