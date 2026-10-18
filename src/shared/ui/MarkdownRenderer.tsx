import { useCallback, useLayoutEffect, useMemo, useRef } from "react";

import { toast } from "../toast";
import { addCodeBlockToolbars, copyCodeBlock } from "./markdown/codeBlockToolbar";
import { renderMarkdown } from "./markdown/renderMarkdown";
import { isSafeLinkUrl } from "./markdown/safeUrl";
import { useHighlighter } from "./markdown/useHighlighter";
import { IsolatedMenu } from "./contextMenu/IsolatedMenu";
import { linkMenuItems, openExternalUrl } from "./contextMenu/menuActions";
import { isContextMenuKey, useContextMenu } from "./contextMenu/useContextMenu";

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
        if (href && isSafeLinkUrl(href)) openExternalUrl(href);
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

  const contextMenu = useContextMenu();
  const { bind, openFromEvent, openUnder } = contextMenu;

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const mention = (e.target as HTMLElement).closest<HTMLElement>(".mention");
      const userId = mention?.getAttribute("data-user-id");
      if (mention && userId) {
        onMentionContextMenu?.(userId, mention, e);
        return;
      }
      const link = linkAt(e.target, e.currentTarget);
      if (link) openFromEvent(e, () => linkMenuItems(link.getAttribute("href") ?? ""));
    },
    [onMentionContextMenu, openFromEvent],
  );

  // A long press on a link opens its menu; once it starts, these follow the touch.
  const pressHandlers = useMemo(() => bind(() => []), [bind]);
  const handleTouchStart = useCallback(
    (e: React.TouchEvent<HTMLElement>) => {
      const link = linkAt(e.target, e.currentTarget);
      if (link) bind(() => linkMenuItems(link.getAttribute("href") ?? "")).onTouchStart(e);
    },
    [bind],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isContextMenuKey(e)) {
        const mention = (e.target as HTMLElement).closest<HTMLElement>(".mention");
        const userId = mention?.getAttribute("data-user-id");
        if (mention && userId) {
          onMentionContextMenu?.(userId, mention, e);
          return;
        }
        const link = linkAt(e.target, e.currentTarget);
        if (link && openUnder(link, () => linkMenuItems(link.getAttribute("href") ?? ""))) {
          e.preventDefault();
        }
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
    [onMentionClick, onMentionContextMenu, openUnder],
  );

  return (
    <>
      <div
        ref={containerRef}
        className={className}
        dangerouslySetInnerHTML={{ __html: html }}
        onClick={handleClick}
        onMouseOver={handleMouseOver}
        onMouseLeave={handleMouseLeave}
        onKeyDown={handleKeyDown}
        onContextMenu={handleContextMenu}
        onTouchStart={handleTouchStart}
        onTouchMove={pressHandlers.onTouchMove}
        onTouchEnd={pressHandlers.onTouchEnd}
        onTouchCancel={pressHandlers.onTouchCancel}
      />
      <IsolatedMenu>{contextMenu.menu}</IsolatedMenu>
    </>
  );
}

/**
 * The rendered link an event on `target` is on, inside `container`. A mention is not a link
 * here: it keeps its own click and the mentioned person's menu.
 */
function linkAt(target: EventTarget | null, container: Element): HTMLAnchorElement | null {
  if (!(target instanceof Element) || target.closest(".mention")) return null;
  const link = target.closest("a[href]");
  return link instanceof HTMLAnchorElement && container.contains(link) ? link : null;
}
