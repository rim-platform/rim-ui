import { useMemo, useCallback } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

import { preprocessMentions, postprocessMentions } from "../utils/mentionRenderer";

const renderer = new marked.Renderer();
renderer.link = ({ href, text }) => {
  return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="text-rim-accent hover:underline">${text}</a>`;
};
marked.use({ renderer });

/** Escape a string for safe use in HTML attribute values */
function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Replace `:custom_name:` shortcodes with inline emoji images */
function replaceCustomEmoji(html: string, emojiMap: Map<string, string>): string {
  return html.replace(/:([a-zA-Z0-9_-]+):/g, (match, name: string) => {
    const url = emojiMap.get(name);
    if (!url) return match;
    const safeUrl = escapeAttr(url);
    return `<img src="${safeUrl}" alt=":${name}:" title=":${name}:" class="inline-block h-5 w-5 align-text-bottom object-contain" />`;
  });
}

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
}

export function MarkdownRenderer({
  content,
  className,
  memberMap,
  customEmojiMap,
  onMentionClick,
  onMentionHover,
  onMentionLeave,
}: MarkdownRendererProps) {
  const html = useMemo(() => {
    let textToRender = content;
    let mentions: Array<{ userId: string; displayName: string }> = [];

    if (memberMap && memberMap.size > 0) {
      const pre = preprocessMentions(textToRender, memberMap);
      textToRender = pre.text;
      mentions = pre.mentions;
    }

    const rawHtml = marked.parse(textToRender, { async: false }) as string;
    let withMentions = mentions.length > 0 ? postprocessMentions(rawHtml, mentions) : rawHtml;

    // Replace :custom_name: shortcodes with emoji images
    if (customEmojiMap && customEmojiMap.size > 0) {
      withMentions = replaceCustomEmoji(withMentions, customEmojiMap);
    }

    return DOMPurify.sanitize(withMentions, {
      ALLOWED_TAGS: [
        "p",
        "br",
        "strong",
        "em",
        "code",
        "pre",
        "ul",
        "ol",
        "li",
        "h1",
        "h2",
        "h3",
        "h4",
        "blockquote",
        "a",
        "span",
        "img",
      ],
      ALLOWED_ATTR: [
        "href",
        "target",
        "rel",
        "class",
        "data-user-id",
        "tabindex",
        "role",
        "src",
        "alt",
        "title",
      ],
    });
  }, [content, memberMap, customEmojiMap]);

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
      if (target.tagName === "A") {
        e.preventDefault();
        const href = target.getAttribute("href");
        if (href) {
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

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
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
    [onMentionClick],
  );

  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={handleClick}
      onMouseOver={handleMouseOver}
      onMouseLeave={handleMouseLeave}
      onKeyDown={handleKeyDown}
    />
  );
}
