import DOMPurify from "dompurify";
import type { ReactNode } from "react";

import { HIGHLIGHT_END, HIGHLIGHT_START, plainMessagePreview } from "../utils/snippetText";

export interface SearchSnippetProps {
  /**
   * Snippet with literal `<mark>…</mark>` highlights around matched terms: the server's
   * `ts_headline` over raw message text, or the desktop cache's HTML-escaped FTS5 snippet.
   * `null` for a purely operator-based query with no free-text component (nothing to
   * highlight).
   */
  headline: string | null;
  /** Plain message text, used as the fallback when `headline` is `null`. */
  text: string;
  /** A workspace member's display name by the id a mention token carries, if known. */
  nameOf: (id: string) => string | undefined;
}

const SENTINELS = new RegExp(`[${HIGHLIGHT_START}${HIGHLIGHT_END}]`, "g");
const MARKED = new RegExp(`${HIGHLIGHT_START}([^${HIGHLIGHT_END}]*)${HIGHLIGHT_END}`);

/**
 * Flattens a sanitized headline to text, wrapping each `<mark>`'s text in the highlight
 * sentinels and dropping sentinels that came with the message text itself.
 *
 * @param fragment - the headline parsed by DOMPurify, with only bare `<mark>` elements left
 * @returns the headline's text with its highlights marked by sentinels
 */
function markedText(fragment: DocumentFragment): string {
  let out = "";
  for (const node of Array.from(fragment.childNodes)) {
    const text = (node.textContent ?? "").replace(SENTINELS, "");
    out += node.nodeName === "MARK" ? `${HIGHLIGHT_START}${text}${HIGHLIGHT_END}` : text;
  }
  return out;
}

/**
 * Renders a search result's snippet as plain text with its matches highlighted.
 *
 * **Security-critical:** `headline` carries `<mark>` tags around matched terms, but the
 * surrounding text is raw user message content and may contain arbitrary markup. DOMPurify,
 * allowing only `<mark>` and no attributes, parses it into a DOM fragment; only the fragment's
 * text is read, with each mark's extent kept as private-use sentinels, so no user markup ever
 * reaches the page and HTML entities decode the same way for both sources. The text then loses
 * its mention tokens and Markdown syntax ({@link plainMessagePreview}): a mention reads as the
 * member's `@name`, a highlight inside a mention's id is dropped, and what the server's cut left
 * of a token at either end is named or dropped. It renders as React text and `<mark>` nodes.
 *
 * Does **not** re-implement client-side substring highlighting: the headline is the source of
 * truth for match highlighting. When `headline` is `null`, renders the plain `text` with its
 * mentions named, its Markdown removed and no highlight.
 */
export function SearchSnippet({ headline, text, nameOf }: SearchSnippetProps) {
  if (headline === null) {
    return (
      <p className="text-xs leading-relaxed text-rim-text-muted line-clamp-2">
        {plainMessagePreview(text, nameOf)}
      </p>
    );
  }

  const fragment = DOMPurify.sanitize(headline, {
    ALLOWED_TAGS: ["mark"],
    ALLOWED_ATTR: [],
    RETURN_DOM_FRAGMENT: true,
  });
  const parts = plainMessagePreview(markedText(fragment), nameOf, { excerpt: true }).split(MARKED);
  const nodes: ReactNode[] = [];
  parts.forEach((part, i) => {
    const clean = part.replace(SENTINELS, "");
    if (!clean) return;
    nodes.push(i % 2 === 1 ? <mark key={i}>{clean}</mark> : clean);
  });

  return (
    <p className="text-xs leading-relaxed text-rim-text-muted line-clamp-2 [&_mark]:rounded-sm [&_mark]:bg-rim-accent/20 [&_mark]:text-rim-accent">
      {nodes}
    </p>
  );
}
