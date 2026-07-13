import DOMPurify from "dompurify";

export interface SearchSnippetProps {
  /**
   * Server-provided `ts_headline` snippet with literal `<mark>…</mark>`
   * highlights around matched terms, or `null` for a purely operator-based
   * query with no free-text component (nothing for the server to highlight).
   */
  headline: string | null;
  /** Plain message text, used as the fallback when `headline` is `null`. */
  text: string;
}

/**
 * Renders a search result's highlighted snippet.
 *
 * **Security-critical:** `headline` contains server-injected `<mark>` tags
 * around matched terms, but the surrounding text is raw user message
 * content and may contain arbitrary markup. It is sanitized with DOMPurify
 * configured to allow *only* the `<mark>` tag and **no** attributes
 * (`ALLOWED_TAGS: ["mark"], ALLOWED_ATTR: []`) before rendering via
 * `dangerouslySetInnerHTML` — this strips any user-embedded tags
 * (`<script>`, `<img onerror>`, etc.), neutralizing XSS, while keeping the
 * highlight markers. This is the codebase's one sanctioned
 * DOMPurify-for-HTML pattern applied to search snippets specifically; see
 * `docs/search-ui.md` for the full rationale.
 *
 * Does **not** re-implement client-side substring highlighting — the server
 * headline is the source of truth for match highlighting. When `headline`
 * is `null`, falls back to the plain, React-auto-escaped `text` (no
 * highlight).
 */
export function SearchSnippet({ headline, text }: SearchSnippetProps) {
  if (headline === null) {
    return <p className="text-xs leading-relaxed text-rim-text-muted line-clamp-2">{text}</p>;
  }

  const sanitized = DOMPurify.sanitize(headline, {
    ALLOWED_TAGS: ["mark"],
    ALLOWED_ATTR: [],
  });

  return (
    <p
      className="text-xs leading-relaxed text-rim-text-muted line-clamp-2 [&_mark]:rounded-sm [&_mark]:bg-rim-accent/20 [&_mark]:text-rim-accent"
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
}
