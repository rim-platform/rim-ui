/** The first letters of a workspace's words, at most two, for a badge. */
export function workspaceInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "").slice(0, 2);
  return letters.toUpperCase() || "?";
}

/** A workspace's badge on the join screens: its initials, since a link's preview has no image. */
export function WorkspaceInitials({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-rim-accent/15 text-sm font-semibold text-rim-accent"
    >
      {workspaceInitials(name)}
    </span>
  );
}
