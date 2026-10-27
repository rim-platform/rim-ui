import type { EmojiMartData } from "@emoji-mart/data";

import { importWithRetry } from "../../../shared/lazy/importWithRetry";
import { shortcodeEntries } from "./emojiShortcodes";

/** One row of the composer's `:` suggestions. */
export interface EmojiSuggestion {
  /** The name shown between colons. */
  code: string;
  /** What choosing it puts in the text: the native character, or `:name:` for a custom emoji. */
  insert: string;
  /** The native character, or `null` for a custom emoji. */
  emoji: string | null;
  /** A custom emoji's image, or `null` for a Unicode one. */
  imageUrl: string | null;
}

/** A Unicode emoji from emoji-mart's data: its id, its keywords and its default-skin character. */
export interface EmojiIndexEntry {
  id: string;
  keywords: string[];
  native: string;
}

/** Most suggestions shown at once. */
const MAX_SUGGESTIONS = 8;

/**
 * A `:` query at the end of the text before the cursor: a colon at the start or after a space,
 * then the start of a name. "10:30" holds none.
 */
export const SHORTCODE_QUERY = /(?:^|\s):([a-zA-Z0-9_][a-zA-Z0-9_+-]*)$/;

let indexPromise: Promise<EmojiIndexEntry[]> | null = null;
let loadedIndex: EmojiIndexEntry[] | null = null;

/**
 * Every Unicode emoji emoji-mart knows, loaded once from the chunk the emoji picker uses.
 *
 * @returns The index; later calls share the first load.
 */
export function loadEmojiIndex(): Promise<EmojiIndexEntry[]> {
  indexPromise ??= importWithRetry(() => import("@emoji-mart/data"))
    .then((module) => {
      const data = module.default as unknown as EmojiMartData;
      loadedIndex = Object.values(data.emojis ?? {}).map((emoji) => ({
        id: emoji.id,
        keywords: emoji.keywords,
        native: emoji.skins[0].native,
      }));
      return loadedIndex;
    })
    .catch((err: unknown) => {
      indexPromise = null;
      throw err;
    });
  return indexPromise;
}

/** The emoji index once {@link loadEmojiIndex} has loaded it, else `null`. */
export function cachedEmojiIndex(): EmojiIndexEntry[] | null {
  return loadedIndex;
}

/**
 * The suggestions for a `:` query, at most 8, each emoji once: the workspace's custom emoji
 * whose name starts with it, then the app's own shortcodes, then Unicode emoji whose id starts
 * with it, then those with a keyword starting with it or a later word of the id starting with it.
 *
 * @param query - The text typed after the colon.
 * @param index - The Unicode emoji, or `null` while they load.
 * @param custom - The workspace's custom emoji.
 */
export function searchEmoji(
  query: string,
  index: readonly EmojiIndexEntry[] | null,
  custom: readonly { name: string; imageUrl: string }[],
): EmojiSuggestion[] {
  const q = query.toLowerCase();
  const results: EmojiSuggestion[] = [];
  const seen = new Set<string>();
  const add = (suggestion: EmojiSuggestion) => {
    if (results.length >= MAX_SUGGESTIONS || seen.has(suggestion.insert)) return;
    seen.add(suggestion.insert);
    results.push(suggestion);
  };
  const unicode = (code: string, emoji: string) =>
    add({ code, insert: emoji, emoji, imageUrl: null });

  for (const emoji of custom) {
    if (emoji.name.toLowerCase().startsWith(q)) {
      add({ code: emoji.name, insert: `:${emoji.name}:`, emoji: null, imageUrl: emoji.imageUrl });
    }
  }
  for (const { code, emoji } of shortcodeEntries()) {
    if (code.toLowerCase().startsWith(q)) unicode(code, emoji);
  }
  for (const entry of index ?? []) {
    if (entry.id.startsWith(q)) unicode(entry.id, entry.native);
  }
  for (const entry of index ?? []) {
    if (entry.keywords.some((k) => k.startsWith(q)) || entry.id.includes(`_${q}`)) {
      unicode(entry.id, entry.native);
    }
  }
  return results;
}
