import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { cn } from "./cn";
import { Z } from "./zIndex";

const EMOJI_OPTIONS = ["\u{1F44D}", "\u{1F44E}", "\u2764\uFE0F", "\u{1F602}", "\u{1F62E}", "\u{1F622}", "\u{1F389}", "\u{1F680}", "\u{1F440}", "\u2705"];
const COLS = 5;

interface EmojiPickerProps {
  position: { x: number; y: number };
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

export type { EmojiPickerProps };

export function EmojiPicker({ position, onSelect, onClose }: EmojiPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);

  // Smart positioning: decide whether to render above or below the anchor point
  const computeStyle = useCallback((): React.CSSProperties => {
    const pickerHeight = 120;
    const pickerWidth = 220;
    const spaceBelow = window.innerHeight - position.y;
    const showAbove = spaceBelow < pickerHeight && position.y > pickerHeight;

    return {
      position: "fixed",
      left: Math.min(position.x, window.innerWidth - pickerWidth - 8),
      zIndex: Z.POPOVER,
      ...(showAbove
        ? { bottom: window.innerHeight - position.y + 4 }
        : { top: position.y + 4 }),
    };
  }, [position.x, position.y]);

  const [style, setStyle] = useState<React.CSSProperties>(() => computeStyle());

  useEffect(() => {
    setStyle(computeStyle());
  }, [computeStyle]);

  // Auto-focus container
  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  function handleKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        setFocusedIndex((prev) => Math.min(prev + 1, EMOJI_OPTIONS.length - 1));
        break;
      case "ArrowLeft":
        e.preventDefault();
        setFocusedIndex((prev) => Math.max(prev - 1, 0));
        break;
      case "ArrowDown":
        e.preventDefault();
        setFocusedIndex((prev) => Math.min(prev + COLS, EMOJI_OPTIONS.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setFocusedIndex((prev) => Math.max(prev - COLS, 0));
        break;
      case "Enter":
        e.preventDefault();
        onSelect(EMOJI_OPTIONS[focusedIndex]);
        break;
      case "Escape":
        e.preventDefault();
        onClose();
        break;
    }
  }

  return createPortal(
    <div
      ref={containerRef}
      role="listbox"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="min-w-[200px] rounded-lg border border-rim-line bg-rim-panel p-2 shadow-lg outline-none"
      style={style}
    >
      <div className="grid grid-cols-5 gap-1.5">
        {EMOJI_OPTIONS.map((emoji, index) => (
          <button
            key={emoji}
            role="option"
            aria-selected={focusedIndex === index}
            type="button"
            tabIndex={-1}
            onClick={() => onSelect(emoji)}
            onMouseEnter={() => setFocusedIndex(index)}
            className={cn(
              "rounded p-1 text-base",
              focusedIndex === index ? "bg-rim-accent/20" : "hover:bg-rim-void",
            )}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
