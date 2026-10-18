import { useCallback, useLayoutEffect, useMemo, useRef } from "react";

import { toast } from "../toast";
import { addCodeBlockToolbars, copyCodeBlock } from "./markdown/codeBlockToolbar";
import { renderMarkdown } from "./markdown/renderMarkdown";
import { isSafeLinkUrl } from "./markdown/safeUrl";
import { useHighlighter } from "./markdown/useHighlighter";
import { isContextMenuKey } from "./contextMenu/useContextMenu";

interface MarkdownRendererProps {
  content: string;
  className?: string;
  /** userId → displayName map for resolving `<@userId>` mention tokens */
  memberMap?: Map<string, string>;
  /** custom emoji name → imageUrl map for resolving `:name:` shortcodes */
  customEmojiMap?: Map<string, string>;
  onMentionClick?: (userId: string, rect: DOMRect) => void;
  onMentionHover?: (userId: string, rect: DOMRect) => void;
  onMentionLeave?: () => void;
  /** Called for a right click, the ContextMenu key or Shift+F10 on a mention. */
  onMentionContextMenu?: (
    userId: string,
    mention: HTMLElement,
    event: React.MouseEvent | React.KeyboardEvent,
  ) => void;
  /** Markdown images render inline when true (the default), as links when false. */
  showInlineMedia?: boolean;
}

export function MarkdownRenderer({
  content,
  className,
  memberMap,
  customEmojiMap,
  onMentionClick,
  onMentionHover,
  onMentionLeave,
  onMentionContextMenu,
  showInlineMedia = true,
}: MarkdownRendererProps) {
  const highlight = useHighlighter(content);
  const html = useMemo(
    () => renderMarkdown(content, { memberMap, customEmojiMap, highlight, showInlineMedia }),
    [content, memberMap, customEmojiMap, highlight, showInlineMedia],
  );

  const containerRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (containerRef.current) addCodeBlockToolbars(containerRef.current);
  }, [html]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const mention = (e.target as HTMLElement).closest(".mention");
      if (mention) {
        const userId = mention.getAttribute("data-user-id");
        if (userId && onMentionClick) {
          onMentionClick(userId, mention.getBoundingClientRect());
        }
        return;
      }

      const target = e.target as HTMLElement;
      const copy = target.closest<HTMLButtonElement>("button[data-code-copy]");
      if (copy) {
        copyCodeBlock(copy).catch(() => toast.error("The code could not be copied"));
        return;
      }

      const link = target.closest("a");
      if (link) {
        e.preventDefault();
        const href = link.getAttribute("href");
        if (href && isSafeLinkUrl(href)) {
          import("@tauri-apps/plugin-opener")
            .then(({ openUrl }) => openUrl(href))
            .catch(() => window.open(href, "_blank"));
        }
      }
    },
    [onMentionClick],
  );

  const handleMouseOver = useCallback(
    (e: React.MouseEvent) => {
      const mention = (e.target as HTMLElement).closest(".mention");
      if (mention && onMentionHover) {
        const userId = mention.getAttribute("data-user-id");
        if (userId) onMentionHover(userId, mention.getBoundingClientRect());
      }
    },
    [onMentionHover],
  );

  const handleMouseLeave = useCallback(() => {
    onMentionLeave?.();
  }, [onMentionLeave]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const mention = (e.target as HTMLElement).closest<HTMLElement>(".mention");
      const userId = mention?.getAttribute("data-user-id");
      if (mention && userId) onMentionContextMenu?.(userId, mention, e);
    },
    [onMentionContextMenu],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isContextMenuKey(e)) {
        const mention = (e.target as HTMLElement).closest<HTMLElement>(".mention");
        const userId = mention?.getAttribute("data-user-id");
        if (mention && userId) onMentionContextMenu?.(userId, mention, e);
        return;
      }
      if (e.key !== "Enter" && e.key !== " ") return;
      const mention = (e.target as HTMLElement).closest(".mention");
      if (mention) {
        e.preventDefault();
        const userId = mention.getAttribute("data-user-id");
        if (userId && onMentionClick) {
          onMentionClick(userId, mention.getBoundingClientRect());
        }
      }
    },
    [onMentionClick, onMentionContextMenu],
  );

  return (
    <div
      ref={containerRef}
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={handleClick}
      onMouseOver={handleMouseOver}
      onMouseLeave={handleMouseLeave}
      onContextMenu={onMentionContextMenu ? handleContextMenu : undefined}
      onKeyDown={handleKeyDown}
    />
  );
}
