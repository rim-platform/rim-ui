/** What each supported agent's row in Settings > Agents shows. */

import type { AcpPreset } from "../acp/acpPresets";
import type { AvailableAgent, CatalogEntry, InstalledAgent } from "../acp/agentInstaller";
import { startsPair } from "../acp/agentPrograms";
import type { AgentProgramProfile } from "../state/useAgentProgramsStore";

/** What a supported agent's row shows. */
export type PresetRowState =
  | {
      kind: "installed";
      installed: InstalledAgent;
      /** The profile that starts it, or `undefined` when none does. */
      profile: AgentProgramProfile | undefined;
      /** The newer version RIM can update it to, or `null`. */
      update: AvailableAgent | null;
    }
  | { kind: "found"; profile: AgentProgramProfile | undefined }
  | { kind: "install"; available: AvailableAgent }
  | { kind: "unavailable"; problem: string | null }
  | { kind: "checking" };

/**
 * What a supported agent's row shows: what RIM installed first, then one the person installed
 * that is on the `PATH` or a profile starts, then whether RIM can install it.
 *
 * @param entry - Its catalog entry, or `undefined` when the catalog has none.
 * @param catalogLoaded - Whether the catalog answered, or failed.
 * @param foundPath - Where its bare program is on the `PATH`, `null` when not, `undefined`
 *   before the lookup answers.
 */
export function presetRowState(
  preset: AcpPreset,
  entry: CatalogEntry | undefined,
  catalogLoaded: boolean,
  foundPath: string | null | undefined,
  profiles: readonly AgentProgramProfile[],
): PresetRowState {
  if (entry?.installed) {
    const installed = entry.installed;
    const update =
      entry.available !== null && entry.available.version !== installed.version
        ? entry.available
        : null;
    return {
      kind: "installed",
      installed,
      profile: profiles.find((profile) => startsPair(profile, installed)),
      update,
    };
  }
  const onPath = profiles.filter(
    (profile) => profile.program === preset.program && profile.resolvedProgram !== null,
  );
  if (typeof foundPath === "string") {
    return {
      kind: "found",
      profile: onPath.find((profile) => profile.resolvedProgram === foundPath),
    };
  }
  if (foundPath === undefined && onPath.length > 0) return { kind: "found", profile: onPath[0] };
  if (entry?.available) return { kind: "install", available: entry.available };
  if (entry) return { kind: "unavailable", problem: entry.problem };
  return catalogLoaded ? { kind: "unavailable", problem: null } : { kind: "checking" };
}

/** The version and licence line, such as "0.102.0 · MIT licence". */
export function versionLine(available: AvailableAgent): string {
  return `${available.version} · ${available.license} licence`;
}
