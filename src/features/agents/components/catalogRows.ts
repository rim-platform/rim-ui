/** What each supported agent's row in Settings > Agents shows. */

import type { AcpPreset } from "../acp/acpPresets";
import {
  formatSize,
  type AvailableAgent,
  type CatalogEntry,
  type CatalogInstalledAgent,
  type InstallerCatalog,
} from "../acp/agentInstaller";
import { startsPair } from "../acp/agentPrograms";
import type { AgentProgramProfile } from "../state/useAgentProgramsStore";

/** What a supported agent's row shows. */
export type PresetRowState =
  | {
      kind: "installed";
      installed: CatalogInstalledAgent;
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

/**
 * The line under **Install**: the version, the licence and the size when it is known, such as
 * "0.102.0 · proprietary licence · about 120 MB download".
 */
export function offerLine(available: AvailableAgent): string {
  const { size } = available;
  if (size === null) return versionLine(available);
  const what = size.kind === "download" ? "download" : "installed";
  return `${versionLine(available)} · about ${formatSize(size.bytes)} ${what}`;
}

/** @returns What an installed agent uses, such as "Uses 433 MB", or `null` when not known. */
export function usesLine(installed: CatalogInstalledAgent): string | null {
  return installed.diskBytes === null ? null : `Uses ${formatSize(installed.diskBytes)}`;
}

function names(list: readonly string[]): string {
  return list.length < 2
    ? list.join("")
    : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/**
 * What everything RIM installed uses, such as "Agents installed by RIM use 1.2 GB on this
 * computer, including Node.js 26.13.0 (214 MB), shared by Codex and Gemini CLI.", naming the
 * installed agents that run on its Node.js.
 *
 * @returns The line, or `null` when nothing is installed.
 */
export function diskUseLine(
  catalog: InstallerCatalog,
  presets: readonly AcpPreset[],
): string | null {
  const installed = presets.filter((preset) =>
    catalog.agents.some((entry) => entry.presetId === preset.id && entry.installed !== null),
  );
  if (installed.length === 0 && catalog.node === null) return null;
  let line = `Agents installed by RIM use ${formatSize(catalog.totalBytes)} on this computer`;
  const { node } = catalog;
  if (node !== null) {
    line += `, including Node.js ${node.version}`;
    if (node.diskBytes !== null) line += ` (${formatSize(node.diskBytes)})`;
    const onNode = installed.filter((preset) => preset.runsOnNode).map((preset) => preset.name);
    if (onNode.length === 1) line += `, used by ${onNode[0]}`;
    if (onNode.length > 1) line += `, shared by ${names(onNode)}`;
  }
  return `${line}.`;
}
