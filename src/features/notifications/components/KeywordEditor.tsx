import { useId } from "react";
import { X } from "lucide-react";

import { MAX_KEYWORDS, addKeywords } from "../rules";

interface KeywordEditorProps {
  keywords: string[];
  onChange: (keywords: string[]) => void;
  /** The text typed but not yet turned into a chip; lifted so Save can commit it. */
  draft: string;
  onDraftChange: (draft: string) => void;
  error: string | null;
  onErrorChange: (error: string | null) => void;
}

/**
 * Keyword alert chips: type a word and press Enter or a comma to add it, click a chip's ×
 * to remove it. Validation mirrors the server (2 to 40 characters, at most 20, lower-cased).
 */
export function KeywordEditor({
  keywords,
  onChange,
  draft,
  onDraftChange,
  error,
  onErrorChange,
}: KeywordEditorProps) {
  const inputId = useId();

  function commit(raw: string) {
    if (!raw.trim()) return;
    const result = addKeywords(keywords, raw);
    if (!result.ok) {
      onErrorChange(result.error);
      return;
    }
    onChange(result.keywords);
    onDraftChange("");
    onErrorChange(null);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit(draft);
    } else if (e.key === "Backspace" && !draft && keywords.length > 0) {
      onChange(keywords.slice(0, -1));
    }
  }

  function handleChange(value: string) {
    // A pasted list ("deploy, outage") becomes chips at once.
    if (value.includes(",")) {
      commit(value);
      return;
    }
    onDraftChange(value);
    if (error) onErrorChange(null);
  }

  return (
    <div>
      <label htmlFor={inputId} className="block text-sm font-medium text-rim-text">
        Keyword alerts
      </label>
      <p className="mt-0.5 text-xs text-rim-text-muted">
        Get notified when a message contains one of these words (whole words, any case), even in
        conversations set to Mentions. Up to {MAX_KEYWORDS}.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-rim-line bg-rim-void px-2 py-1.5 focus-within:border-rim-accent/40">
        {keywords.map((keyword) => (
          <span
            key={keyword}
            className="flex items-center gap-1 rounded bg-rim-accent/10 px-1.5 py-0.5 text-xs text-rim-accent"
          >
            {keyword}
            <button
              type="button"
              onClick={() => onChange(keywords.filter((k) => k !== keyword))}
              aria-label={`Remove keyword ${keyword}`}
              className="rounded text-rim-accent/70 transition hover:text-rim-accent"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          id={inputId}
          type="text"
          value={draft}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={keywords.length === 0 ? "e.g. deploy, outage" : "Add a keyword"}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
          className="min-w-[8rem] flex-1 bg-transparent py-0.5 text-sm text-rim-text outline-none placeholder:text-rim-text-faint"
        />
      </div>
      {error && (
        <p id={`${inputId}-error`} role="alert" className="mt-1 text-xs text-rim-danger">
          {error}
        </p>
      )}
    </div>
  );
}
