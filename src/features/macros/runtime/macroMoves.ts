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

/** Forgets that the macros of the workspace `workspaceId` moved, so the move reads it again. */
export function forgetMovedWorkspace(userId: string, workspaceId: string): void {
  try {
    const done = movedWorkspaces(userId);
    if (done === "all" || !done.has(workspaceId)) return;
    localStorage.setItem(
      doneKey(userId),
      JSON.stringify([...done].filter((id) => id !== workspaceId)),
    );
  } catch {
    // Storage unavailable: there is nothing kept to forget.
  }
}

/** A workspace macro that stayed where it was in the last move of its workspace, and why. */
export interface StayedMacro {
  workspaceId: string;
  workspaceName: string;
  /** The workspace macro's id. */
  macroId: string;
  title: string;
  /** The server's refusal, or that the person keeps the most macros they may. */
  reason: string;
}

function stayedKey(userId: string): string {
  return `rim.macroMovesStayed.${macroMoveAccount(userId)}`;
}

function isStayedMacro(value: unknown): value is StayedMacro {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return ["workspaceId", "workspaceName", "macroId", "title", "reason"].every(
    (key) => typeof entry[key] === "string",
  );
}

/** The workspace macros of the account `userId` that stayed where they were; empty when unread. */
export function readStayedMacros(userId: string): StayedMacro[] {
  try {
    const raw = localStorage.getItem(stayedKey(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isStayedMacro) : [];
  } catch {
    return [];
  }
}

function writeStayedMacros(userId: string, stayed: readonly StayedMacro[]): void {
  try {
    if (stayed.length === 0) localStorage.removeItem(stayedKey(userId));
    else localStorage.setItem(stayedKey(userId), JSON.stringify(stayed));
  } catch {
    // Storage unavailable: the macros still stay in their workspaces.
  }
}

/** Replaces what stayed in the workspace `workspaceId` with `stayed`, from its latest move. */
export function recordStayedMacros(
  userId: string,
  workspaceId: string,
  stayed: readonly StayedMacro[],
): void {
  writeStayedMacros(userId, [
    ...readStayedMacros(userId).filter((entry) => entry.workspaceId !== workspaceId),
    ...stayed,
  ]);
}

/** Forgets the stayed workspace macro `macroId`, once it is deleted. */
export function forgetStayedMacro(userId: string, macroId: string): void {
  writeStayedMacros(
    userId,
    readStayedMacros(userId).filter((entry) => entry.macroId !== macroId),
  );
}

/** Forgets which macros the account `userId` moved, an account removed from this device. */
export function forgetMacroMoves(userId: string): void {
  try {
    localStorage.removeItem(movesKey(userId));
    localStorage.removeItem(doneKey(userId));
    localStorage.removeItem(stayedKey(userId));
  } catch {
    // Storage unavailable: there is nothing kept to forget.
  }
}
