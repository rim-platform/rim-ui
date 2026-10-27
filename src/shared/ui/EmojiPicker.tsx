import { Suspense, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";

import { lazyWithRetry } from "../lazy/importWithRetry";
import { useServerMediaUrls } from "../media/serverMedia";
import { Z } from "./zIndex";

/** Minimal custom emoji shape needed by the picker (avoids importing from features/emoji). */
export interface CustomEmoji {
  id: string;
  name: string;
  imageUrl: string;
}

interface EmojiPickerProps {
  position: { x: number; y: number };
  onSelect: (emoji: string) => void;
  onClose: () => void;
  /** Custom emoji for the current workspace */
  customEmojis?: CustomEmoji[];
}

export type { EmojiPickerProps };

// Dynamically import the heavy emoji-mart bundle (~450 kB data + picker JS)
// only when the picker is first rendered. Subsequent renders use the cached module.
const LazyPicker = lazyWithRetry(async () => {
  const [{ default: Picker }, { default: data }] = await Promise.all([
    import("@emoji-mart/react"),
    import("@emoji-mart/data"),
  ]);

  // Wrap into a named default export that Suspense / lazy can consume
  function EmojiMartPicker(props: React.ComponentProps<typeof Picker>) {
    return <Picker {...props} data={data} />;
  }

  return { default: EmojiMartPicker };
});

const PICKER_WIDTH = 352;
const PICKER_HEIGHT = 435;

/**
 * Full-featured emoji picker using emoji-mart.
 * - All Unicode emojis organized by category
 * - Search bar
 * - Skin tone picker
 * - Frequently used / recents
 * - Custom workspace emojis
 * - Dark theme matching RIM design
 *
 * emoji-mart is loaded lazily on first render (not part of the main bundle).
 */
export function EmojiPicker({ position, onSelect, onClose, customEmojis }: EmojiPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const sources = useServerMediaUrls(
    useMemo(() => customEmojis?.map((e) => e.imageUrl) ?? [], [customEmojis]),
  );

  // Custom emoji whose image can be shown, in emoji-mart's format
  const custom = useMemo(() => {
    const emojis = (customEmojis ?? []).flatMap((e) => {
      const src = sources.get(e.imageUrl);
      return src
        ? [{ id: `custom_${e.id}`, name: e.name, keywords: [e.name], skins: [{ src }] }]
        : [];
    });
    if (emojis.length === 0) return undefined;
    return [{ id: "custom", name: "Custom", emojis }];
  }, [customEmojis, sources]);

  // Smart positioning: decide whether to render above or below the anchor point
  const style = useMemo((): React.CSSProperties => {
    const spaceBelow = window.innerHeight - position.y;
    const showAbove = spaceBelow < PICKER_HEIGHT && position.y > PICKER_HEIGHT;

    return {
      position: "fixed",
      left: Math.min(position.x, window.innerWidth - PICKER_WIDTH - 8),
      zIndex: Z.POPOVER,
      ...(showAbove ? { bottom: window.innerHeight - position.y + 4 } : { top: position.y + 4 }),
    };
  }, [position.x, position.y]);

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    // Use setTimeout to avoid the same click that opened the picker from closing it
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleEmojiSelect = useCallback(
    (emoji: { native?: string; id?: string; name?: string; shortcodes?: string }) => {
      if (emoji.native) {
        // Standard Unicode emoji
        onSelect(emoji.native);
      } else if (emoji.id?.startsWith("custom_")) {
        // Custom emoji — insert as :name: shortcode
        onSelect(`:${emoji.name}:`);
      } else if (emoji.shortcodes) {
        // Fallback — use shortcode representation
        onSelect(emoji.shortcodes);
      }
    },
    [onSelect],
  );

  return createPortal(
    <div
      ref={containerRef}
      role="dialog"
      aria-label="Emoji picker"
      style={style}
      className="rounded-lg shadow-xl"
    >
      <Suspense fallback={null}>
        {/* emoji-mart builds its custom category once, so a new image re-creates the picker */}
        <LazyPicker
          key={custom?.[0].emojis.length ?? 0}
          onEmojiSelect={handleEmojiSelect}
          theme="dark"
          custom={custom}
          perLine={9}
          emojiSize={22}
          emojiButtonSize={32}
          maxFrequentRows={2}
          previewPosition="none"
          skinTonePosition="search"
          navPosition="top"
          set="native"
        />
      </Suspense>
    </div>,
    document.body,
  );
}
