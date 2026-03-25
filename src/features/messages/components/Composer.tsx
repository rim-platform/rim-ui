import { useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Send, SmilePlus } from "lucide-react";

import { EmojiPicker } from "../../../shared/ui/EmojiPicker";
import { Z } from "../../../shared/ui/zIndex";
import { useSendMessageMutation } from "../api/useMessages";
import { replaceShortcodes, getShortcodeSuggestions } from "../utils/emojiShortcodes";
import { cn } from "../../../shared/ui/cn";

export function Composer({ workspaceId, conversationId }: { workspaceId: string; conversationId: string }) {
  const [text, setText] = useState("");
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Array<{ code: string; emoji: string }>>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const send = useSendMessageMutation();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;

    const processed = replaceShortcodes(trimmed);

    send.mutate(
      { workspaceId, conversationId, text: processed },
      {
        onSuccess: () => {
          setText("");
          setSuggestions([]);
          if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
          }
          textareaRef.current?.focus();
        },
      },
    );
  }

  // Extract the current partial shortcode being typed (word touching cursor)
  const getPartialShortcode = useCallback((value: string, cursorPos: number): string | null => {
    const before = value.slice(0, cursorPos);
    const match = before.match(/:([a-zA-Z0-9_]*)$/);
    if (match) return match[0];
    return null;
  }, []);

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.currentTarget.value;
    const cursorPos = e.currentTarget.selectionStart ?? value.length;
    setText(value);

    // Auto-resize
    const el = e.currentTarget;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;

    const partial = getPartialShortcode(value, cursorPos);
    if (partial && partial.length >= 2) {
      const results = getShortcodeSuggestions(partial);
      setSuggestions(results);
      setSelectedSuggestion(0);
    } else {
      setSuggestions([]);
    }
  }

  function applySuggestion(suggestion: { code: string; emoji: string }) {
    const cursorPos = textareaRef.current?.selectionStart ?? text.length;
    const before = text.slice(0, cursorPos);
    const after = text.slice(cursorPos);
    const match = before.match(/:([a-zA-Z0-9_]*)$/);
    if (match) {
      const newBefore = before.slice(0, before.length - match[0].length) + suggestion.emoji;
      setText(newBefore + after);
    }
    setSuggestions([]);
    textareaRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedSuggestion((prev) => Math.min(prev + 1, suggestions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedSuggestion((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        applySuggestion(suggestions[selectedSuggestion]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSuggestions([]);
        return;
      }
    }

    // Enter without Shift sends the message
    if (e.key === "Enter" && !e.shiftKey && suggestions.length === 0) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  function insertEmoji(emoji: string) {
    setText((prev) => prev + emoji);
    setEmojiPickerOpen(false);
    textareaRef.current?.focus();
  }

  const getEmojiPickerPosition = useCallback(() => {
    if (!emojiButtonRef.current) return { x: 0, y: 0 };
    const rect = emojiButtonRef.current.getBoundingClientRect();
    return {
      x: Math.min(rect.left, window.innerWidth - 220),
      y: rect.top,
    };
  }, []);

  // Compute suggestions position
  const suggestionsStyle: React.CSSProperties = (() => {
    if (!textareaRef.current) return { position: "absolute", top: 0, left: 0 };
    const rect = textareaRef.current.getBoundingClientRect();
    return {
      position: "fixed",
      bottom: window.innerHeight - rect.top + 4,
      left: rect.left,
      minWidth: 220,
      zIndex: Z.POPOVER,
    };
  })();

  return (
    <form onSubmit={handleSubmit} className="relative flex items-end gap-2 border-t border-rim-line px-4 py-3">
      <textarea
        ref={textareaRef}
        rows={1}
        value={text}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        placeholder="Write a message..."
        className="flex-1 resize-none rounded-lg border border-rim-line bg-rim-void px-3 py-2 text-sm text-white outline-none transition placeholder:text-rim-text-faint focus:border-rim-accent/40"
        style={{ height: "auto" }}
      />
      <button
        ref={emojiButtonRef}
        type="button"
        onClick={() => setEmojiPickerOpen((prev) => !prev)}
        className="rounded-lg p-2 text-rim-text-muted transition hover:text-rim-accent"
        title="Insert emoji"
        aria-label="Insert emoji"
      >
        <SmilePlus className="h-4 w-4" />
      </button>
      <button
        type="submit"
        disabled={send.isPending || !text.trim()}
        className="rounded-lg bg-rim-accent p-2 text-rim-void transition hover:bg-rim-accent-strong disabled:opacity-50"
        aria-label="Send message"
      >
        <Send className="h-4 w-4" />
      </button>

      {suggestions.length > 0 && createPortal(
        <div
          ref={suggestionsRef}
          className="rounded-lg border border-rim-line bg-rim-panel shadow-lg"
          style={suggestionsStyle}
        >
          {suggestions.map((s, i) => (
            <button
              key={s.code}
              type="button"
              onClick={() => applySuggestion(s)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5 text-sm",
                i === selectedSuggestion ? "bg-rim-accent/20 text-white" : "text-rim-text hover:bg-white/[0.05]",
              )}
            >
              <span className="text-base">{s.emoji}</span>
              <span className="text-rim-text-muted">{s.code}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}

      {emojiPickerOpen && (
        <EmojiPicker
          position={getEmojiPickerPosition()}
          onSelect={insertEmoji}
          onClose={() => setEmojiPickerOpen(false)}
        />
      )}
    </form>
  );
}
