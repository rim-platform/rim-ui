/**
 * The agent installer's commands and events (`src-tauri/src/agent_installer`): which of the
 * supported agents RIM can install on this computer, installing or updating one after a native
 * dialog, and removing its files. RIM installs each into its own folder and allows the program
 * it installed itself, so the page never asks the runner to allow it. Every function throws an
 * `Error` whose message the UI can show: the installer's own sentence, or
 * {@link DESKTOP_ONLY_MESSAGE} off the desktop app.
 */

import { callDesktop, DESKTOP_ONLY_MESSAGE, listenDesktop } from "./desktopIpc";

export { DESKTOP_ONLY_MESSAGE };

/** The event with the progress of an install. */
export const AGENT_INSTALL_PROGRESS_EVENT = "agent-installer://progress";

/**
 * How big an agent is before it is installed: the archive RIM downloads, or what npm puts on
 * disk.
 */
export interface AgentSize {
  bytes: number;
  kind: "download" | "installed";
}

/** A version of an agent RIM can install. */
export interface AvailableAgent {
  version: string;
  /** The licence as the agent's registry entry names it, such as `MIT` or `proprietary`. */
  license: string;
  /** Where RIM downloads it from. */
  source: string;
  /** How big it is, or `null` when RIM could not tell. */
  size: AgentSize | null;
}

/** An agent RIM installed. */
export interface InstalledAgent {
  presetId: string;
  version: string;
  /** The full path RIM starts, which the runner's allowed list holds. */
  program: string;
  args: string[];
  /** When it was installed, in milliseconds since the Unix epoch. */
  installedAt: number;
}

/** An agent RIM installed, with what it uses on disk. */
export interface CatalogInstalledAgent extends InstalledAgent {
  /** The bytes its files use, or `null` when they could not be read. */
  diskBytes: number | null;
}

/** One supported agent, as the installer sees it on this computer. */
export interface CatalogEntry {
  presetId: string;
  name: string;
  /** The version RIM would install, or `null` when it can't install it here. */
  available: AvailableAgent | null;
  /** What RIM installed, or `null`. */
  installed: CatalogInstalledAgent | null;
  /** Why it can't be installed or checked, as a sentence, or `null`. */
  problem: string | null;
}

/** RIM's own Node.js, which the agents installed from npm run on. */
export interface InstalledNode {
  version: string;
  /** The bytes its files use, or `null` when they could not be read. */
  diskBytes: number | null;
}

/** What the installer reports: the supported agents and what RIM's agents use on disk. */
export interface InstallerCatalog {
  /** Each supported agent, in the order of the presets. */
  agents: CatalogEntry[];
  /** RIM's Node.js when it is installed, or `null`. */
  node: InstalledNode | null;
  /** What installing RIM's Node.js downloads, when it isn't installed and that is known. */
  nodeDownload: number | null;
  /** The bytes everything in RIM's agents folder uses. */
  totalBytes: number;
}

/** A program and its exact arguments, as the runner's allowed list holds them. */
export interface ProgramPair {
  program: string;
  args: string[];
}

/**
 * What became of an install: `installed`, with the pair it replaced on an update when that
 * differs, or `declined` in the native dialog.
 */
export type InstallOutcome =
  { kind: "installed"; agent: InstalledAgent; replaced: ProgramPair | null } | { kind: "declined" };

/** Where an install is. */
export type InstallStage =
  "node" | "downloading" | "checking" | "unpacking" | "installing" | "done";

/** The progress of an install. */
export interface InstallProgress {
  presetId: string;
  stage: InstallStage;
  /** The bytes downloaded so far, or `null`. */
  received: number | null;
  /** The bytes to download, or `null` when not known. */
  total: number | null;
}

/** @returns Each supported agent, in the order of the presets, and what they use on disk. */
export function agentInstallerCatalog(): Promise<InstallerCatalog> {
  return callDesktop("agent_installer_catalog");
}

/**
 * Installs an agent, or updates it to the version the catalog offers, after the person agrees
 * in a native dialog that names its version, source and licence. On an update the old version's
 * files go once the new one is in place.
 *
 * @param presetId - The preset to install.
 * @returns What became of it.
 */
export function installAgent(presetId: string): Promise<InstallOutcome> {
  return callDesktop("agent_installer_install", { presetId });
}

/**
 * Deletes an installed agent's files and takes its program off the allowed list. Refuses while
 * one of its sessions runs.
 *
 * @param presetId - The preset to remove.
 */
export async function removeInstalledAgent(presetId: string): Promise<void> {
  await callDesktop<null>("agent_installer_remove", { presetId });
}

/**
 * Calls `callback` with the progress of every install.
 *
 * @returns A function that stops listening.
 */
export function onInstallProgress(callback: (progress: InstallProgress) => void): () => void {
  return listenDesktop(AGENT_INSTALL_PROGRESS_EVENT, callback);
}

/**
 * A size as the person reads it, in decimal units: one decimal under 10 MB ("4.2 MB"), whole
 * megabytes up to 1000 MB ("120 MB"), and gigabytes with one decimal above ("1.2 GB").
 */
export function formatSize(bytes: number): string {
  const tenths = (value: number) => `${Math.floor(value / 10)}.${value % 10}`;
  const tenthsMb = Math.round(bytes / 100_000);
  if (tenthsMb < 100) return `${tenths(tenthsMb)} MB`;
  const mb = Math.round(bytes / 1_000_000);
  if (mb < 1000) return `${mb} MB`;
  return `${tenths(Math.round(bytes / 100_000_000))} GB`;
}

function megabytes(bytes: number): string {
  const value = bytes / 1_000_000;
  return value < 10 ? value.toFixed(1) : String(Math.round(value));
}

/**
 * The progress as the person reads it, such as "Downloading… 34 of 120 MB".
 *
 * @returns The line, or `null` once the install is done.
 */
export function progressLine(progress: InstallProgress): string | null {
  const { received, total } = progress;
  const amount =
    received === null
      ? ""
      : total !== null && total > 0
        ? ` ${megabytes(received)} of ${megabytes(total)} MB`
        : ` ${megabytes(received)} MB`;
  switch (progress.stage) {
    case "node":
      return `Downloading Node.js…${amount}`;
    case "downloading":
      return `Downloading…${amount}`;
    case "checking":
      return "Checking…";
    case "unpacking":
      return "Unpacking…";
    case "installing":
      return "Installing…";
    case "done":
      return null;
  }
}
