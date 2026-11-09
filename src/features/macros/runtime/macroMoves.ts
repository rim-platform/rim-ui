import { getApiOrigin } from "../../../core/graphql/config";

/** The account `userId` of the connected server, as the record of moved macros names it. */
export function macroMoveAccount(userId: string): string {
  return `${getApiOrigin()}:${userId}`;
}

function movesKey(userId: string): string {
  return `rim.macroMoves.${macroMoveAccount(userId)}`;
}

/**
 * The workspace macros of the account `userId` that moved into the person's macros, each old id
 * with the id (`user.<key>`) of the macro it became; empty when none moved or storage cannot be
 * read.
 */
export function readMacroMoves(userId: string): Readonly<Record<string, string>> {
  try {
    const raw = localStorage.getItem(movesKey(userId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

/**
 * Adds `moves` (old workspace macro id to the id of the macro it became) to what the account
 * `userId` has moved.
 *
 * @returns Whether storage kept them.
 */
export function recordMacroMoves(userId: string, moves: Readonly<Record<string, string>>): boolean {
  try {
    localStorage.setItem(movesKey(userId), JSON.stringify({ ...readMacroMoves(userId), ...moves }));
    return true;
  } catch {
    return false;
  }
}

function doneKey(userId: string): string {
  return `rim.macroMovesDone.${macroMoveAccount(userId)}`;
}

/**
 * The workspaces whose macros the account `userId` has moved, so they are not read again; every
 * workspace when storage cannot be read, so nothing moves twice.
 */
export function movedWorkspaces(userId: string): ReadonlySet<string> | "all" {
  let raw: string | null;
  try {
    raw = localStorage.getItem(doneKey(userId));
  } catch {
    return "all";
  }
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    return new Set(
      Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [],
    );
  } catch {
    return new Set();
  }
}

/** Records that the macros of the workspace `workspaceId` moved for the account `userId`. */
export function recordMovedWorkspace(userId: string, workspaceId: string): void {
  try {
    const done = movedWorkspaces(userId);
    if (done === "all" || done.has(workspaceId)) return;
    localStorage.setItem(doneKey(userId), JSON.stringify([...done, workspaceId]));
  } catch {
    // Storage unavailable: movedWorkspaces then reads every workspace as moved.
  }
}

/** Forgets which macros the account `userId` moved, an account removed from this device. */
export function forgetMacroMoves(userId: string): void {
  try {
    localStorage.removeItem(movesKey(userId));
    localStorage.removeItem(doneKey(userId));
  } catch {
    // Storage unavailable: there is nothing kept to forget.
  }
}
