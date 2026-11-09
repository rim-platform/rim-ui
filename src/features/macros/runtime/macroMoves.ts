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

/** Forgets which macros the account `userId` moved, an account removed from this device. */
export function forgetMacroMoves(userId: string): void {
  try {
    localStorage.removeItem(movesKey(userId));
  } catch {
    // Storage unavailable: there is nothing kept to forget.
  }
}
