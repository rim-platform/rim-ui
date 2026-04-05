import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { cn } from "./cn";
import { Z } from "./zIndex";
import type { CustomEmoji } from "../../features/emoji/api/useCustomEmojis";

const EMOJI_OPTIONS = ["\u{1F44D}", "\u{1F44E}", "\u2764\uFE0F", "\u{1F602}", "\u{1F62E}", "\u{1F622}", "\u{1F389}", "\u{1F680}", "\u{1F440}", "\u2705"];
const COLS = 5;

interface EmojiPickerProps {
  position: { x: number; y: number };
  onSelect: (emoji: string) => void;
  onClose: () => void;
  /** Custom emoji for the current workspace */
  customEmojis?: CustomEmoji[];
}

export type { EmojiPickerProps };

export function EmojiPicker({ position, onSelect, onClose, customEmojis }: EmojiPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);

  const hasCustom = customEmojis && customEmojis.length > 0;
  const totalItems = (hasCustom ? customEmojis.length : 0) + EMOJI_OPTIONS.length;

  // Smart positioning: decide whether to render above or below the anchor point
  const computeStyle = useCallback((): React.CSSProperties => {
    const pickerHeight = hasCustom ? 200 : 120;
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
  }, [position.x, position.y, hasCustom]);

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

  function handleSelect(index: number) {
    const customCount = hasCustom ? customEmojis!.length : 0;
    if (index < customCount && customEmojis) {
      // Custom emoji — insert as :name: shortcode
      onSelect(`:${customEmojis[index].name}:`);
    } else {
      onSelect(EMOJI_OPTIONS[index - customCount]);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        setFocusedIndex((prev) => Math.min(prev + 1, totalItems - 1));
        break;
      case "ArrowLeft":
        e.preventDefault();
        setFocusedIndex((prev) => Math.max(prev - 1, 0));
        break;
      case "ArrowDown":
        e.preventDefault();
        setFocusedIndex((prev) => Math.min(prev + COLS, totalItems - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setFocusedIndex((prev) => Math.max(prev - COLS, 0));
        break;
      case "Enter":
        e.preventDefault();
        handleSelect(focusedIndex);
        break;
      case "Escape":
        e.preventDefault();
        onClose();
        break;
    }
  }

  const customCount = hasCustom ? customEmojis.length : 0;

  return createPortal(
    <div
      ref={containerRef}
      role="listbox"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="min-w-[200px] max-h-[280px] overflow-y-auto rounded-lg border border-rim-line bg-rim-panel p-2 shadow-lg outline-none"
      style={style}
    >
      {hasCustom && (
        <>
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-rim-text-faint">
            Custom
          </p>
          <div className="grid grid-cols-5 gap-1.5">
            {customEmojis.map((emoji, index) => (
              <button
                key={emoji.id}
                role="option"
                aria-selected={focusedIndex === index}
                aria-label={emoji.name}
                type="button"
                tabIndex={-1}
                onClick={() => onSelect(`:${emoji.name}:`)}
                onMouseEnter={() => setFocusedIndex(index)}
                className={cn(
                  "rounded p-1",
                  focusedIndex === index ? "bg-rim-accent/20" : "hover:bg-rim-void",
                )}
                title={`:${emoji.name}:`}
              >
                <img
                  src={emoji.imageUrl}
                  alt={emoji.name}
                  className="h-5 w-5 object-contain"
                />
              </button>
            ))}
          </div>
          <div className="my-1.5 border-t border-rim-line" />
        </>
      )}
      <div className="grid grid-cols-5 gap-1.5">
        {EMOJI_OPTIONS.map((emoji, index) => {
          const globalIndex = customCount + index;
          return (
            <button
              key={emoji}
              role="option"
              aria-selected={focusedIndex === globalIndex}
              type="button"
              tabIndex={-1}
              onClick={() => onSelect(emoji)}
              onMouseEnter={() => setFocusedIndex(globalIndex)}
              className={cn(
                "rounded p-1 text-base",
                focusedIndex === globalIndex ? "bg-rim-accent/20" : "hover:bg-rim-void",
              )}
            >
              {emoji}
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
