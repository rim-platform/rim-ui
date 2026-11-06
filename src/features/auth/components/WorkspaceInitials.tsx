/**
 * The first letter or digit of each of a workspace's first two words, upper-cased; `?` when
 * it has none. Whole characters, so an emoji or a format mark never becomes a letter.
 */
export function workspaceInitials(name: string): string {
  const letters: string[] = [];
  for (const word of name.split(/\s+/)) {
    const first = word.match(/[\p{L}\p{N}]/u)?.[0];
    if (first) letters.push(first);
    if (letters.length === 2) break;
  }
  return letters.join("").toUpperCase() || "?";
}

/** A workspace's badge on the join screens: its initials, since a link's preview has no image. */
export function WorkspaceInitials({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-rim-line-strong bg-rim-panel text-sm font-semibold text-rim-text"
    >
      {workspaceInitials(name)}
    </span>
  );
}
