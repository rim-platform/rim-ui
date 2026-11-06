/** Makes text that could hide or reorder what a person reads safe to show them. */

const SHOWN_BY_NAME = /[\p{Cf}\p{Cc}\u{2028}\u{2029}]/u;
const JOINS_EMOJI = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\u{FE00}-\u{FE0F}]/u;
const ZERO_WIDTH_JOINER = "\u{200D}";

function visibleName(character: string): string {
  const code = character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0");
  return `⟦U+${code}⟧`;
}

/**
 * Text with bidirectional controls and invisible characters replaced by a visible name, e.g.
 * ⟦U+202E⟧. Tabs and newlines stay, as do variation selectors, and a zero-width joiner between two
 * parts of an emoji.
 *
 * @param text - The text as it will be sent.
 * @returns The text to display; only ever used for showing, never for sending.
 */
export function showInvisibleCharacters(text: string): string {
  const characters = Array.from(text);
  return characters
    .map((character, index) => {
      if (character === "\n" || character === "\t") return character;
      if (!SHOWN_BY_NAME.test(character)) return character;
      const joinsEmoji =
        character === ZERO_WIDTH_JOINER &&
        JOINS_EMOJI.test(characters[index - 1] ?? "") &&
        JOINS_EMOJI.test(characters[index + 1] ?? "");
      return joinsEmoji ? character : visibleName(character);
    })
    .join("");
}
