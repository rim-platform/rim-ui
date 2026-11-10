import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { registerSealedStore, sealedStateStorage } from "../../../core/accountVault/sealedStorage";

/** An agent program the person added, which RIM may start. */
export interface AgentProgramProfile {
  id: string;
  /** What the person calls it. */
  name: string;
  /** A full path, or a bare name looked up on the computer's `PATH`. */
  program: string;
  /**
   * The program's full path as the runner's allowed list holds it, which RIM starts, or `null`
   * for a profile stored before RIM kept it and not yet found again.
   */
  resolvedProgram: string | null;
  args: string[];
  /** The folder a session starts in unless the person picks another, a full path. */
  defaultFolder: string | null;
  /** The preset it was added from, or `null` for a custom program. */
  presetId: string | null;
  /** The connected agent RIM made for it, with nothing granted at first. */
  agentId: string;
  /** The plain token of that agent, handed to the program in each session. Never shown or logged. */
  token: string;
  /** When it was added, ISO 8601. */
  addedAt: string;
}

/** The fields of a profile the person can change. */
export type AgentProgramChanges = Partial<
  Pick<AgentProgramProfile, "name" | "program" | "resolvedProgram" | "args" | "defaultFolder">
>;

interface AgentProgramsState {
  profiles: AgentProgramProfile[];
  add: (profile: AgentProgramProfile) => void;
  update: (id: string, changes: AgentProgramChanges) => void;
  remove: (id: string) => void;
}

/** The stored shape's version. */
const STORE_VERSION = 0;

function isString(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * Brings stored profiles up to the current shape, leaving out any that lack what a profile
 * needs.
 *
 * @param persisted - What the storage held, of any version.
 * @returns The state with every profile in the current shape.
 */
export function migrateAgentPrograms(persisted: unknown): { profiles: AgentProgramProfile[] } {
  const stored = (persisted as { profiles?: unknown } | null | undefined)?.profiles;
  if (!Array.isArray(stored)) return { profiles: [] };
  const profiles: AgentProgramProfile[] = [];
  for (const item of stored as Partial<Record<keyof AgentProgramProfile, unknown>>[]) {
    if (typeof item !== "object" || item === null) continue;
    const { id, name, program, resolvedProgram, args, defaultFolder, presetId, agentId, token } =
      item;
    if (![id, name, program, agentId, token].every(isString)) continue;
    profiles.push({
      id: id as string,
      name: name as string,
      program: program as string,
      resolvedProgram: isString(resolvedProgram) && resolvedProgram !== "" ? resolvedProgram : null,
      args: Array.isArray(args) ? args.filter(isString) : [],
      defaultFolder: isString(defaultFolder) && defaultFolder !== "" ? defaultFolder : null,
      presetId: isString(presetId) ? presetId : null,
      agentId: agentId as string,
      token: token as string,
      addedAt: isString(item.addedAt) ? item.addedAt : new Date(0).toISOString(),
    });
  }
  return { profiles };
}

/** The agent programs RIM may start for this account on this device, sealed under the account vault. */
export const useAgentProgramsStore = create<AgentProgramsState>()(
  persist(
    (set) => ({
      profiles: [],
      add: (profile) => set((state) => ({ profiles: [...state.profiles, profile] })),
      update: (id, changes) =>
        set((state) => ({
          profiles: state.profiles.map((profile) =>
            profile.id === id ? { ...profile, ...changes } : profile,
          ),
        })),
      remove: (id) =>
        set((state) => ({ profiles: state.profiles.filter((profile) => profile.id !== id) })),
    }),
    {
      name: "rim-agent-programs",
      storage: createJSONStorage(() => sealedStateStorage),
      skipHydration: true,
      version: STORE_VERSION,
      migrate: (persisted) => migrateAgentPrograms(persisted) as AgentProgramsState,
      merge: (persisted, current) => ({ ...current, ...migrateAgentPrograms(persisted) }),
    },
  ),
);
registerSealedStore(useAgentProgramsStore);
// Hydrates at once as well, for when this module loads after the vault was unlocked.
void useAgentProgramsStore.persist.rehydrate();
