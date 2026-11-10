/**
 * Adding, changing and removing the agent programs RIM may start. Each program and its exact
 * arguments are asked about in the runner's native dialog before they are saved, and each
 * profile is a connected agent of its own, made with nothing granted.
 */

import { logger } from "../../../core/logger";
import { cleanName, mintAgent } from "../runtime/pairing";
import { useConnectedAgentsStore } from "../state/useConnectedAgentsStore";
import {
  useAgentProgramsStore,
  type AgentProgramChanges,
  type AgentProgramProfile,
} from "../state/useAgentProgramsStore";
import {
  allowAgentProgram,
  allowedAgentPrograms,
  findAgentPrograms,
  forgetAgentProgram,
} from "./agentRunner";

/** What adding a program needs. */
export interface NewAgentProgram {
  name: string;
  program: string;
  args: string[];
  defaultFolder: string | null;
  presetId: string | null;
}

/** What became of a program after the native dialog. */
export type AllowOutcome = "added" | "changed" | "refused";

/** The sentence for a name that is nothing once cleaned. */
export const NAME_NEEDED = "Give it a name.";
/** The sentence for an empty program. */
export const PROGRAM_NEEDED = "Choose the program to start.";
/** The sentence when RIM cannot tell which full path the person allowed. */
export const NOT_RESOLVED = "RIM could not tell which program was allowed. Try adding it again.";
/** The sentence for a folder that is not a full path. */
export const FOLDER_NOT_FULL = "Write the folder's full path, or leave it empty.";

/** The arguments as the person writes them: one per line, blank lines left out. */
export function parseArgsText(text: string): string[] {
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** Whether `path` is a full path on this or another desktop system. */
export function isFullPath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(path) || path.startsWith("\\\\");
}

/** @returns The folder trimmed, or `null` when empty. Throws {@link FOLDER_NOT_FULL} otherwise. */
function cleanFolder(folder: string | null | undefined): string | null {
  const trimmed = folder?.trim() ?? "";
  if (trimmed === "") return null;
  if (!isFullPath(trimmed)) throw new Error(FOLDER_NOT_FULL);
  return trimmed;
}

function cleanProgram(program: string): string {
  const trimmed = program.trim();
  if (trimmed === "") throw new Error(PROGRAM_NEEDED);
  return trimmed;
}

function sameArgs(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((arg, index) => arg === b[index]);
}

/** The program's file name without a Windows extension, in lower case on Windows paths. */
function baseName(path: string): string {
  const name = path.split(/[\\/]/u).pop() ?? path;
  return /\\/u.test(path) ? name.replace(/\.[^.]*$/u, "").toLowerCase() : name;
}

/**
 * The full path the runner's allowed list holds for this program and exactly these arguments:
 * the program itself when it is a full path, otherwise where the runner finds it on `PATH`, or
 * the one allowed entry with these arguments and its name.
 *
 * @returns The full path, or `null` when the list holds no such entry.
 */
export async function resolveAllowedProgram(
  program: string,
  args: readonly string[],
): Promise<string | null> {
  const entries = (await allowedAgentPrograms()).filter((entry) => sameArgs(entry.args, args));
  if (isFullPath(program)) {
    return entries.some((entry) => entry.program === program) ? program : null;
  }
  const [found] = await findAgentPrograms([program]);
  if (found && entries.some((entry) => entry.program === found)) return found;
  const named = entries.filter((entry) => baseName(entry.program) === baseName(program));
  return named.length === 1 ? named[0].program : null;
}

/** What a profile's program is on the allowed list: its full path once known. */
function allowedProgramOf(profile: Pick<AgentProgramProfile, "program" | "resolvedProgram">) {
  return profile.resolvedProgram ?? profile.program;
}

/** Whether a profile other than `exceptId` starts this program with these arguments. */
function pairInUse(program: string, args: readonly string[], exceptId: string): boolean {
  return useAgentProgramsStore
    .getState()
    .profiles.some(
      (profile) =>
        profile.id !== exceptId &&
        allowedProgramOf(profile) === program &&
        sameArgs(profile.args, args),
    );
}

/**
 * Asks about a program in the native dialog and finds the full path the person allowed.
 *
 * @returns The full path, or `null` when the person did not allow it. Throws
 *   {@link NOT_RESOLVED} when the path cannot be told, after taking the pair off the list
 *   unless another profile starts it.
 */
async function allowAndResolve(program: string, args: string[]): Promise<string | null> {
  if (!(await allowAgentProgram(program, args))) return null;
  const resolved = await resolveAllowedProgram(program, args).catch(() => null);
  if (resolved !== null) return resolved;
  const inUse = useAgentProgramsStore
    .getState()
    .profiles.some((profile) => profile.program === program && sameArgs(profile.args, args));
  if (!inUse) await forgetAgentProgram(program, args).catch(() => {});
  throw new Error(NOT_RESOLVED);
}

/**
 * Takes a program and its arguments off the runner's allowed list, unless another profile
 * still starts them. A failure is logged and reported, and changes nothing else.
 *
 * @returns Whether the list no longer holds the pair for this profile.
 */
async function forgetPair(program: string, args: string[], exceptId: string): Promise<boolean> {
  if (pairInUse(program, args, exceptId)) return true;
  try {
    await forgetAgentProgram(program, args);
    return true;
  } catch {
    logger.warn("[RIM:agents] could not take an agent program off the allowed list");
    return false;
  }
}

/**
 * Adds an agent program: asks in the native dialog, then makes its connected agent.
 *
 * @param input - The program as the person entered it.
 * @returns The new profile, or `null` when the person did not allow it. Throws a sentence when
 *   the input is not valid or the runner refused it.
 */
export async function addAgentProgram(input: NewAgentProgram): Promise<AgentProgramProfile | null> {
  const name = cleanName(input.name);
  if (name === null) throw new Error(NAME_NEEDED);
  const program = cleanProgram(input.program);
  const args = [...input.args];
  const defaultFolder = cleanFolder(input.defaultFolder);
  const resolvedProgram = await allowAndResolve(program, args);
  if (resolvedProgram === null) return null;
  const minted = await mintAgent(name);
  if (minted === null) throw new Error(NAME_NEEDED);
  const profile: AgentProgramProfile = {
    id: crypto.randomUUID(),
    name: minted.agent.name,
    program,
    resolvedProgram,
    args,
    defaultFolder,
    presetId: input.presetId,
    agentId: minted.agent.id,
    token: minted.token,
    addedAt: new Date().toISOString(),
  };
  useConnectedAgentsStore.getState().add(minted.agent);
  useAgentProgramsStore.getState().add(profile);
  return profile;
}

/**
 * Changes a profile. A new program or new arguments are asked about in the native dialog
 * first, and the old pair is taken off the allowed list only after the new one was allowed.
 *
 * @returns `changed`, or `refused` when the person did not allow the new pair and nothing
 *   changed. Throws a sentence when the input is not valid, the profile is gone or the runner
 *   refused it.
 */
export async function editAgentProgram(
  id: string,
  changes: AgentProgramChanges,
): Promise<AllowOutcome> {
  const current = useAgentProgramsStore.getState().profiles.find((profile) => profile.id === id);
  if (!current) throw new Error("That agent program is no longer there.");
  const next: AgentProgramChanges = {};
  if (changes.name !== undefined) {
    const name = cleanName(changes.name);
    if (name === null) throw new Error(NAME_NEEDED);
    next.name = name;
  }
  if (changes.defaultFolder !== undefined) next.defaultFolder = cleanFolder(changes.defaultFolder);
  const program = changes.program !== undefined ? cleanProgram(changes.program) : current.program;
  const args = changes.args !== undefined ? [...changes.args] : current.args;
  const commandChanged = program !== current.program || !sameArgs(args, current.args);
  if (commandChanged) {
    const resolvedProgram = await allowAndResolve(program, args);
    if (resolvedProgram === null) return "refused";
    next.program = program;
    next.resolvedProgram = resolvedProgram;
    next.args = args;
  }
  useAgentProgramsStore.getState().update(id, next);
  if (next.name !== undefined)
    useConnectedAgentsStore.getState().rename(current.agentId, next.name);
  if (commandChanged) await forgetPair(allowedProgramOf(current), current.args, id);
  return "changed";
}

/**
 * Removes a profile and disconnects its agent at once, then takes its program off the allowed
 * list.
 *
 * @returns Whether the program came off the allowed list; the profile and its agent are gone
 *   either way.
 */
export async function removeAgentProgram(id: string): Promise<boolean> {
  const profile = useAgentProgramsStore.getState().profiles.find((p) => p.id === id);
  if (!profile) return true;
  useConnectedAgentsStore.getState().revoke(profile.agentId);
  useAgentProgramsStore.getState().remove(id);
  return forgetPair(allowedProgramOf(profile), profile.args, id);
}

/**
 * Finds the full path of each stored profile that has none, through the runner's allowed list.
 * A profile that cannot be resolved keeps `null` and has to be added again.
 */
export async function resolveStoredPrograms(): Promise<void> {
  const missing = useAgentProgramsStore
    .getState()
    .profiles.filter((profile) => profile.resolvedProgram === null);
  for (const profile of missing) {
    const resolved = await resolveAllowedProgram(profile.program, profile.args).catch(() => null);
    if (resolved !== null) {
      useAgentProgramsStore.getState().update(profile.id, { resolvedProgram: resolved });
    }
  }
}

/** @returns The profile whose agent is `agentId`, or `undefined`. */
export function profileOfAgent(agentId: string): AgentProgramProfile | undefined {
  return useAgentProgramsStore.getState().profiles.find((profile) => profile.agentId === agentId);
}

/**
 * Disconnects an agent, and removes the profile it was made for, if any.
 *
 * @returns Whether the profile's program came off the allowed list, `true` when there was none.
 */
export async function disconnectAgent(agentId: string): Promise<boolean> {
  const profile = profileOfAgent(agentId);
  if (profile) return removeAgentProgram(profile.id);
  useConnectedAgentsStore.getState().revoke(agentId);
  return true;
}
