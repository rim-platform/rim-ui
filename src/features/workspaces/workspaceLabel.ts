/** A workspace as the label helpers see it. */
export interface LabelledWorkspace {
  name: string;
  /** The owner's name as shown, from {@link ownerName}. */
  ownerName?: string | null;
  /** Where a workspace hosted elsewhere lives; absent for this server's own. */
  origin?: string | null;
}

/** The name a workspace owner is shown by: the display name, else the username. */
export function ownerName(
  owner: { username: string; displayName?: string | null } | null | undefined,
): string | null {
  if (!owner) return null;
  return owner.displayName?.trim() || owner.username;
}

/** Whether two workspace names read as the same: trimmed, case-insensitive. */
export function sameWorkspaceName(a: string, b: string): boolean {
  return nameKey(a) === nameKey(b);
}

function nameKey(name: string): string {
  return name.trim().toLocaleLowerCase();
}

/**
 * Each workspace's label among the visible ones, in order: its trimmed name, plus the owner in
 * parentheses when another visible workspace shares the name. A workspace hosted elsewhere
 * always gets its origin.
 * E.g. `Design`, `Design (Alice)`, `Design (Alice, on rim.example.org)`.
 */
export function workspaceLabels(workspaces: readonly LabelledWorkspace[]): string[] {
  const counts = new Map<string, number>();
  for (const ws of workspaces) {
    const key = nameKey(ws.name);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return workspaces.map((ws) => {
    const shared = (counts.get(nameKey(ws.name)) ?? 0) > 1;
    const parts = [
      ...(shared && ws.ownerName ? [ws.ownerName] : []),
      ...(ws.origin ? [`on ${ws.origin}`] : []),
    ];
    const name = ws.name.trim();
    return parts.length > 0 ? `${name} (${parts.join(", ")})` : name;
  });
}
