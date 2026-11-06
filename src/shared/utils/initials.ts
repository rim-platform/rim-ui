/** The first letter or digit of `word`, whole, or `null` when it has none. */
function firstLetterOf(word: string): string | null {
  return word.match(/[\p{L}\p{N}]/u)?.[0] ?? null;
}

/**
 * The first letter or digit of a name, upper-cased; `?` when it has none. A whole character, so
 * an emoji's surrogate pair or a format mark never becomes a stray half.
 */
export function firstLetter(name: string): string {
  return firstLetterOf(name)?.toUpperCase() ?? "?";
}

/**
 * The first letter or digit of each of a workspace's first two words, upper-cased; `?` when it
 * has none. Whole characters, so an emoji or a format mark never becomes a letter.
 */
export function workspaceInitials(name: string): string {
  const letters: string[] = [];
  for (const word of name.split(/\s+/)) {
    const first = firstLetterOf(word);
    if (first) letters.push(first);
    if (letters.length === 2) break;
  }
  return letters.join("").toUpperCase() || "?";
}
