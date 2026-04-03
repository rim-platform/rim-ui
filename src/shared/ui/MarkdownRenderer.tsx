import { useMemo, useCallback } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

const renderer = new marked.Renderer();
renderer.link = ({ href, text }) => {
  return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="text-rim-accent hover:underline">${text}</a>`;
};
marked.use({ renderer });

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  const html = useMemo(() => {
    const rawHtml = marked.parse(content, { async: false }) as string;
    return DOMPurify.sanitize(rawHtml, {
      ALLOWED_TAGS: ["p", "br", "strong", "em", "code", "pre", "ul", "ol", "li", "h1", "h2", "h3", "h4", "blockquote", "a", "span"],
      ALLOWED_ATTR: ["href", "target", "rel", "class"],
    });
  }, [content]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "A") {
      e.preventDefault();
      const href = target.getAttribute("href");
      if (href) {
        import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(href)).catch(() => window.open(href, "_blank"));
      }
    }
  }, []);

  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={handleClick}
    />
  );
}
