import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { graphqlErrorCode, graphqlErrorMessage } from "../../../core/graphql/errors";
import { logger } from "../../../core/logger";
import { queryKeys } from "../../../core/query/keys";
import { queryClient } from "../../../core/query/queryClient";
import { toast } from "../../../shared/toast";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { createUserCommand, invalidateAccountMacros } from "../../commands/api/useUserCommands";
import type { CreateUserCommandInput } from "../../commands/types";
import { isDirectSpace, useRelayStore } from "../../relay/state/useRelayStore";
import { useMyServers } from "../../workspaces/api/useMyServers";
import {
  fetchMacroStepCommands,
  refetchAccountMacros,
  useAccountMacrosOn,
  type AccountMacro,
  type AccountMacroStep,
  type MacroStepCommand,
} from "../api/useAccountMacros";
import { deleteWorkspaceMacro, fetchMacrosToMove, type MacroToMove } from "../api/useMacros";
import { agentOptionBlocker, macroKeyFromTitle } from "./macroCommands";
import {
  forgetMovedWorkspace,
  forgetStayedMacro,
  movedWorkspaces,
  readMacroMoves,
  readStayedMacros,
  recordMacroMoves,
  recordMovedWorkspace,
  recordStayedMacros,
  type StayedMacro,
} from "./macroMoves";
import { MAX_MACROS } from "./macroSteps";

/** The most characters a macro's title may have. */
const MAX_TITLE_LENGTH = 128;

/** A workspace whose macros may move, with the name the person knows it by. */
export interface MoveWorkspace {
  id: string;
  name: string;
}

/** What moving workspace macros reads and writes, so a test can stand in for the servers. */
export interface MacroMoveDeps {
  /** The person's macros on the home server, read now. */
  accountMacros: () => Promise<AccountMacro[]>;
  stepCommands: () => Promise<MacroStepCommand[]>;
  workspaceMacros: (workspaceId: string) => Promise<MacroToMove[]>;
  create: (input: CreateUserCommandInput) => Promise<void>;
  deleteWorkspaceMacro: (macroId: string, workspaceId: string) => Promise<void>;
}

const defaultDeps: MacroMoveDeps = {
  accountMacros: refetchAccountMacros,
  stepCommands: fetchMacroStepCommands,
  workspaceMacros: fetchMacrosToMove,
  create: createUserCommand,
  deleteWorkspaceMacro,
};

/** How one move went. */
export interface MacroMoveSummary {
  /** Workspace macros that became macros, or that a macro with their title and steps replaced. */
  moved: number;
  /** Workspace macros the home server refused, which stay in their workspace. */
  refused: number;
  /** Workspace macros that stay in their workspace because the person has 100 macros. */
  left: number;
}

function argsOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Whether a macro's steps are a workspace macro's: the same commands with the same arguments. */
function sameSteps(
  saved: readonly AccountMacroStep[],
  steps: readonly { commandId: string; args: Record<string, unknown> }[],
): boolean {
  return (
    saved.length === steps.length &&
    saved.every(
      (step, i) =>
        step.commandId === steps[i].commandId &&
        step.ask.length === 0 &&
        JSON.stringify(argsOf(step.args)) === JSON.stringify(steps[i].args),
    )
  );
}

/** `name`, or `name (2)`, `(3)` and on when one of `macros` already has that title. */
function uniqueTitle(name: string, macros: readonly AccountMacro[]): string {
  const taken = new Set(macros.map((m) => m.title.trim().toLowerCase()));
  const base = name.trim().slice(0, MAX_TITLE_LENGTH) || "Macro";
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n += 1) {
    const suffix = ` (${n})`;
    const title = `${base.slice(0, MAX_TITLE_LENGTH - suffix.length).trimEnd()}${suffix}`;
    if (!taken.has(title.toLowerCase())) return title;
  }
}

function plural(count: number): string {
  return count === 1 ? "macro" : "macros";
}

/** Whether `err` is the server refusing a request, rather than the request not reaching it. */
function refusedByServer(err: unknown): boolean {
  return graphqlErrorCode(err) !== undefined;
}

const running = new Map<string, Promise<MacroMoveSummary>>();

/**
 * Moves the person's workspace macros into their own macros, once per workspace: each becomes a
 * macro with its title, description and steps on the home server, and is then deleted where it
 * was. One with the title and steps of an existing macro is only deleted. Its own sensitivity is
 * dropped; the agent may run the new macro only when it may run every step. At 100 macros the
 * rest stay in their workspaces. A workspace is read again next time unless every one of its
 * macros moved, stayed or was refused.
 *
 * @param userId - The signed-in account.
 * @param workspaces - The workspaces the person is in, on this server and elsewhere.
 * @returns How many moved, were refused and stayed for the limit.
 */
export function moveWorkspaceMacros(
  userId: string,
  workspaces: readonly MoveWorkspace[],
  deps: MacroMoveDeps = defaultDeps,
): Promise<MacroMoveSummary> {
  const before = running.get(userId) ?? Promise.resolve(null);
  const next = before
    .catch(() => null)
    .then(() => moveOnce(userId, workspaces, deps))
    .finally(() => {
      if (running.get(userId) === next) running.delete(userId);
    });
  running.set(userId, next);
  return next;
}

async function moveOnce(
  userId: string,
  workspaces: readonly MoveWorkspace[],
  deps: MacroMoveDeps,
): Promise<MacroMoveSummary> {
  const summary: MacroMoveSummary = { moved: 0, refused: 0, left: 0 };
  const done = movedWorkspaces(userId);
  if (done === "all") return summary;
  const pending = workspaces.filter((ws) => !done.has(ws.id) && !isDirectSpace(ws.id));
  if (pending.length === 0) return summary;

  let existing: AccountMacro[];
  let stepCommands: MacroStepCommand[];
  try {
    [existing, stepCommands] = await Promise.all([deps.accountMacros(), deps.stepCommands()]);
  } catch (err) {
    logger.warn("[RIM:macros] could not read the macros to move workspace macros into:", err);
    return summary;
  }
  existing = [...existing];
  const commands = new Map(stepCommands.map((command) => [command.id, command]));

  for (const workspace of pending) {
    let macros: MacroToMove[];
    try {
      macros = await deps.workspaceMacros(workspace.id);
    } catch (err) {
      logger.warn("[RIM:macros] could not read a workspace's macros to move:", err);
      continue;
    }
    let complete = true;
    let left = 0;
    const stayed: StayedMacro[] = [];
    const stay = (macro: MacroToMove, reason: string) =>
      stayed.push({
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        macroId: macro.id,
        title: macro.name,
        reason,
      });
    const recorded = readMacroMoves(userId);
    for (const macro of macros) {
      const steps = macro.steps.map((step) => ({
        commandId: step.commandId,
        args: argsOf(step.args),
      }));
      // A macro this move made earlier, whose workspace macro was not deleted then, or one with
      // the same title and steps.
      const earlier = recorded[macro.id];
      const twin =
        (earlier !== undefined ? existing.find((m) => m.id === earlier) : undefined) ??
        existing.find((m) => m.title.trim() === macro.name.trim() && sameSteps(m.steps, steps));
      let movedTo = twin?.id;
      if (!movedTo) {
        if (existing.length >= MAX_MACROS) {
          left += 1;
          stay(macro, `you have ${MAX_MACROS} macros`);
          continue;
        }
        const title = uniqueTitle(macro.name, existing);
        const id = `user.${macroKeyFromTitle(
          title,
          existing.map((m) => m.id),
        )}`;
        const asked = steps.map((step) => ({ commandId: step.commandId, ask: [] }));
        const input: CreateUserCommandInput = {
          commandId: id,
          title,
          description: macro.description ?? "",
          steps: steps.map((step) =>
            Object.keys(step.args).length > 0
              ? { commandId: step.commandId, args: step.args }
              : { commandId: step.commandId },
          ),
          aiCallable:
            macro.aiCallable && agentOptionBlocker(asked, (cid) => commands.get(cid)) === null,
          nlDescription: macro.nlDescription,
          intentSamples: macro.intentSamples,
        };
        try {
          await createOnce(input, deps);
        } catch (err) {
          if (refusedByServer(err)) {
            summary.refused += 1;
            stay(macro, graphqlErrorMessage(err, "the server refused it"));
          } else complete = false;
          logger.warn("[RIM:macros] a workspace macro could not be moved:", err);
          continue;
        }
        existing.push({
          id,
          title,
          description: input.description,
          isEnabled: true,
          aiCallable: input.aiCallable ?? false,
          nlDescription: input.nlDescription ?? "",
          intentSamples: input.intentSamples ?? [],
          steps: steps.map((step) => ({ ...step, ask: [] })),
        });
        movedTo = id;
      }
      recordMacroMoves(userId, { [macro.id]: movedTo });
      summary.moved += 1;
      try {
        await deps.deleteWorkspaceMacro(macro.id, workspace.id);
      } catch (err) {
        complete = false;
        logger.warn("[RIM:macros] a moved workspace macro could not be deleted:", err);
      }
    }
    if (left > 0) {
      summary.left += left;
      toast.warning(
        `${left} ${plural(left)} stayed in ${workspace.name}: you can keep ${MAX_MACROS} macros`,
      );
    }
    recordStayedMacros(userId, workspace.id, stayed);
    if (complete) recordMovedWorkspace(userId, workspace.id);
  }
  void queryClient.invalidateQueries({ queryKey: queryKeys.macroMovesStayed(userId) });

  if (summary.moved > 0) {
    invalidateAccountMacros();
    void queryClient.invalidateQueries({ queryKey: queryKeys.macros() });
    toast.success(`${summary.moved} workspace ${plural(summary.moved)} moved into your macros`, {
      description: "Your macros work in every workspace. Find them in Settings > Macros.",
    });
  }
  if (summary.refused > 0) {
    toast.error(
      summary.refused === 1
        ? "1 workspace macro could not be moved and stays where it was"
        : `${summary.refused} workspace macros could not be moved and stay where they were`,
    );
  }
  return summary;
}

/**
 * Creates the macro; when the server refuses it with the agent option or the words for the
 * agent, which have checks of their own, once more without them.
 */
async function createOnce(input: CreateUserCommandInput, deps: MacroMoveDeps): Promise<void> {
  try {
    await deps.create(input);
  } catch (err) {
    const { aiCallable, nlDescription, intentSamples, ...plain } = input;
    const forAgent = aiCallable || Boolean(nlDescription) || (intentSamples?.length ?? 0) > 0;
    if (!forAgent || !refusedByServer(err)) throw err;
    await deps.create({ ...plain, aiCallable: false });
  }
}

/**
 * Moves the macros of `workspace` again: what stayed there in the last move is tried once more.
 *
 * @param userId - The signed-in account.
 * @param workspace - The workspace whose macros stayed.
 * @returns How the move went.
 */
export function retryWorkspaceMove(
  userId: string,
  workspace: MoveWorkspace,
  deps: MacroMoveDeps = defaultDeps,
): Promise<MacroMoveSummary> {
  forgetMovedWorkspace(userId, workspace.id);
  return moveWorkspaceMacros(userId, [workspace], deps);
}

/**
 * Deletes a workspace macro that stayed where it was, on the server that hosts its workspace,
 * and forgets that it stayed.
 */
export async function deleteStayedMacro(
  userId: string,
  stayed: StayedMacro,
  deps: Pick<MacroMoveDeps, "deleteWorkspaceMacro"> = defaultDeps,
): Promise<void> {
  try {
    await deps.deleteWorkspaceMacro(stayed.macroId, stayed.workspaceId);
  } catch (err) {
    if (graphqlErrorCode(err) !== "NOT_FOUND") throw err;
  }
  forgetStayedMacro(userId, stayed.macroId);
  void queryClient.invalidateQueries({ queryKey: queryKeys.macroMovesStayed(userId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.macros() });
}

const NO_STAYED: StayedMacro[] = [];

/** The signed-in person's workspace macros that stayed in their workspace in the last move. */
export function useStayedMacros(): StayedMacro[] {
  const userId = useAuthStore((s) => s.session?.userId);
  const { data } = useQuery(
    {
      queryKey: queryKeys.macroMovesStayed(userId),
      queryFn: () => (userId ? readStayedMacros(userId) : []),
      enabled: Boolean(userId),
      staleTime: Infinity,
    },
    queryClient,
  );
  return data ?? NO_STAYED;
}

/**
 * Moves the signed-in person's workspace macros into their own macros once the home server lists
 * `account_macros`, and again when a workspace joins the list.
 */
export function useMoveWorkspaceMacros(): void {
  const userId = useAuthStore((s) => s.session?.userId);
  const on = useAccountMacrosOn();
  const { data: servers } = useMyServers(Boolean(userId) && on);
  const spaces = useRelayStore((s) => s.spaces);
  const workspaces = useMemo(() => {
    const byId = new Map<string, MoveWorkspace>();
    for (const server of servers ?? []) byId.set(server.id, { id: server.id, name: server.name });
    for (const space of Object.values(spaces)) {
      if (space.kind !== "workspace" || byId.has(space.spaceId)) continue;
      byId.set(space.spaceId, { id: space.spaceId, name: space.name ?? "a workspace" });
    }
    return [...byId.values()];
  }, [servers, spaces]);
  const serversLoaded = servers !== undefined;
  const ids = workspaces
    .map((ws) => ws.id)
    .sort()
    .join(" ");
  useEffect(() => {
    if (!userId || !on || !serversLoaded) return;
    void moveWorkspaceMacros(userId, workspaces);
    // The move runs again only when the set of workspaces changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, on, ids, serversLoaded]);
}
