import { useMemo } from "react";

import { useServerMediaUrls } from "../../../shared/media/serverMedia";
import { useCustomEmojis } from "../api/useCustomEmojis";

/** A `:name:` shortcode, as the Markdown renderer replaces it. */
const SHORTCODE = /:([a-zA-Z0-9_-]+):/g;

/**
 * The custom emoji a message's text names, by name, each with a `src` this app can show;
 * `undefined` when the text names none that has arrived.
 *
 * @param text - The message's Markdown text.
 * @param workspaceId - The workspace whose custom emoji the text may name.
 */
export function useMessageEmojiMap(
  text: string | null | undefined,
  workspaceId: string | null | undefined,
): Map<string, string> | undefined {
  const names = useMemo(
    () => new Set(Array.from((text ?? "").matchAll(SHORTCODE), (m) => m[1])),
    [text],
  );
  const { emojis } = useCustomEmojis(names.size > 0 ? (workspaceId ?? null) : null);
  const named = useMemo(() => emojis.filter((e) => names.has(e.name)), [emojis, names]);
  const sources = useServerMediaUrls(useMemo(() => named.map((e) => e.imageUrl), [named]));
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const emoji of named) {
      const src = sources.get(emoji.imageUrl);
      if (src) map.set(emoji.name, src);
    }
    return map.size > 0 ? map : undefined;
  }, [named, sources]);
}
