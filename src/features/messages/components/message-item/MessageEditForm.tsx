import { memo, useEffect, useRef, useState } from "react";

interface MessageEditFormProps {
  messageId: string;
  initialText: string;
  editError?: boolean;
  onSaveEdit?: (messageId: string, newText: string) => void;
  onCancelEdit?: () => void;
}

/** Inline edit form. Mounted only while the message is being edited. */
export const MessageEditForm = memo(function MessageEditForm({
  messageId,
  initialText,
  editError,
  onSaveEdit,
  onCancelEdit,
}: MessageEditFormProps) {
  const [editText, setEditText] = useState(initialText);
  const [sourceText, setSourceText] = useState(initialText);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset when the source text changes while editing (e.g. a remote edit).
  if (sourceText !== initialText) {
    setSourceText(initialText);
    setEditText(initialText);
  }

  // Focus the textarea with the caret at the end once it is painted.
  useEffect(() => {
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
    });
  }, [initialText]);

  function submit() {
    const trimmed = editText.trim();
    if (trimmed && trimmed !== initialText) {
      onSaveEdit?.(messageId, trimmed);
    } else {
      onCancelEdit?.();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancelEdit?.();
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="mt-0.5">
      <textarea
        ref={textareaRef}
        data-owns-escape=""
        className="w-full resize-none rounded border border-rim-line bg-rim-panel px-2 py-1 text-sm text-rim-text outline-none focus:border-rim-accent"
        value={editText}
        onChange={(e) => setEditText(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={Math.max(1, editText.split("\n").length)}
      />
      <div className="mt-1 flex gap-2">
        <button
          type="button"
          className="rounded bg-rim-accent px-2 py-0.5 text-xs text-rim-text transition hover:brightness-110"
          onClick={submit}
        >
          Save
        </button>
        <button
          type="button"
          className="rounded px-2 py-0.5 text-xs text-rim-text-muted transition hover:text-rim-text"
          onClick={() => onCancelEdit?.()}
        >
          Cancel
        </button>
        <span className="text-xs text-rim-text-faint leading-5">
          Enter to save &middot; Esc to cancel
        </span>
      </div>
      {editError && <p className="mt-1 text-xs text-rim-danger">Failed to save. Try again.</p>}
    </div>
  );
});
