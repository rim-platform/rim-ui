/**
 * Adding, changing and removing the agent programs RIM may start. Each program and its exact
 * arguments are asked about in the runner's native dialog before they are saved, or in the
 * installer's when RIM installs it, and each profile is a connected agent of its own, made with
 * nothing granted.
 */

import { logger } from "../../../core/logger";
import { cleanName, mintAgent } from "../runtime/pairing";
import { useConnectedAgentsStore } from "../state/useConnectedAgentsStore";
import {
  useAgentProgramsStore,
  type AgentProgramChanges,
  type AgentProgramProfile,
} from "../state/useAgentProgramsStore";
import { removeInstalledAgent, type InstalledAgent, type ProgramPair } from "./agentInstaller";
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
  return saveProfile({
    name,
    program,
    resolvedProgram,
    args,
    defaultFolder,
    presetId: input.presetId,
  });
}

/** What saving a profile needs, its program already on the runner's allowed list. */
interface AllowedProfile {
  name: string;
  program: string;
  resolvedProgram: string;
  args: string[];
  defaultFolder: string | null;
  presetId: string | null;
}

/**
 * Makes the connected agent for a program already on the allowed list, and saves its profile.
 *
 * @returns The new profile. Throws {@link NAME_NEEDED} when the name is nothing once cleaned.
 */
async function saveProfile(input: AllowedProfile): Promise<AgentProgramProfile> {
  const minted = await mintAgent(input.name);
  if (minted === null) throw new Error(NAME_NEEDED);
  const profile: AgentProgramProfile = {
    id: crypto.randomUUID(),
    name: minted.agent.name,
    program: input.program,
    resolvedProgram: input.resolvedProgram,
    args: [...input.args],
    defaultFolder: input.defaultFolder,
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
 * Whether a profile starts this program with exactly these arguments, by the full path the
 * allowed list holds. Agents RIM installs on Node.js share one program and differ only in their
 * arguments.
 */
export function startsPair(
  profile: Pick<AgentProgramProfile, "program" | "resolvedProgram" | "args">,
  pair: ProgramPair,
): boolean {
  return allowedProgramOf(profile) === pair.program && sameArgs(profile.args, pair.args);
}

/** The profiles that start this program with exactly these arguments. */
export function profilesUsing(pair: ProgramPair): AgentProgramProfile[] {
  return useAgentProgramsStore.getState().profiles.filter((profile) => startsPair(profile, pair));
}

/**
 * Keeps the profiles in step with an agent RIM installed, which the installer already put on
 * the allowed list. An update moves the profiles that started the old pair to the new one;
 * otherwise the profile that starts it is kept, or a new one is made with its connected agent.
 *
 * @param preset - The preset it was installed from.
 * @param agent - What RIM installed.
 * @param replaced - The program and arguments the install replaced, or `null`.
 * @returns The profile that starts it.
 */
export async function adoptInstalledAgent(
  preset: { id: string; name: string },
  agent: Pick<InstalledAgent, "program" | "args">,
  replaced: ProgramPair | null,
): Promise<AgentProgramProfile> {
  const store = useAgentProgramsStore.getState();
  const moved = replaced === null ? [] : profilesUsing(replaced);
  for (const profile of moved) {
    store.update(profile.id, {
      program: agent.program,
      resolvedProgram: agent.program,
      args: [...agent.args],
    });
  }
  const current = useAgentProgramsStore
    .getState()
    .profiles.find((profile) => startsPair(profile, agent));
  if (current) return current;
  return saveProfile({
    name: preset.name,
    program: agent.program,
    resolvedProgram: agent.program,
    args: agent.args,
    defaultFolder: null,
    presetId: preset.id,
  });
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
 * Deletes the files of an agent RIM installed, then removes each profile that starts its
 * program with its arguments and disconnects its agent. Nothing is removed when the installer refuses, such as while one of
 * its sessions runs.
 *
 * @param agent - What RIM installed.
 */
export async function removeInstalledAgentFiles(
  agent: Pick<InstalledAgent, "presetId" | "program" | "args">,
): Promise<void> {
  await removeInstalledAgent(agent.presetId);
  for (const profile of profilesUsing(agent)) await removeAgentProgram(profile.id);
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
