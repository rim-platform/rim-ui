/** The state of Settings > Agents' supported agents: the installer's catalog and its installs. */

import { useCallback, useEffect, useState } from "react";

import type { AcpPreset } from "../acp/acpPresets";
import {
  agentInstallerCatalog,
  installAgent,
  onInstallProgress,
  type InstallerCatalog,
  type InstalledAgent,
  type InstallProgress,
} from "../acp/agentInstaller";
import { adoptInstalledAgent, removeInstalledAgentFiles } from "../acp/agentPrograms";

/** What the installer is doing now. */
export interface InstallerBusy {
  presetId: string;
  action: "install" | "remove";
}

/** A preset RIM just installed, and the profile that starts it. */
export interface JustInstalled {
  presetId: string;
  profileId: string;
}

/** The installer's state and what the page can ask of it. */
export interface AgentInstallerState {
  /** The catalog with what RIM's agents use on disk, or `null` until it loads or when it could not. */
  catalog: InstallerCatalog | null;
  /** Why the catalog could not load, as a sentence, or `null`. */
  catalogError: string | null;
  busy: InstallerBusy | null;
  /** The last progress heard for the install running now, or `null`. */
  progress: InstallProgress | null;
  /** The sentence of the last failure, by preset id. */
  errors: Record<string, string>;
  justInstalled: JustInstalled | null;
  /** Installs a preset, or updates it, and keeps its profile in step. */
  install: (preset: AcpPreset) => Promise<void>;
  /** Removes an installed agent's files and the profiles that start it. */
  remove: (installed: InstalledAgent) => Promise<void>;
  /** Forgets the offer to sign in to an agent just installed. */
  dismissJustInstalled: () => void;
}

function sentence(error: unknown, fallback: string): string {
  return error instanceof Error && error.message !== "" ? error.message : fallback;
}

/**
 * Loads the installer's catalog once, and runs one install or removal at a time.
 *
 * @returns The state and its actions.
 */
export function useAgentInstaller(): AgentInstallerState {
  const [catalog, setCatalog] = useState<InstallerCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [busy, setBusy] = useState<InstallerBusy | null>(null);
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [justInstalled, setJustInstalled] = useState<JustInstalled | null>(null);

  const load = useCallback(async () => {
    try {
      const loaded = await agentInstallerCatalog();
      setCatalog(loaded);
      setCatalogError(null);
    } catch (error) {
      setCatalogError(sentence(error, "RIM could not check which agents it can install."));
    }
  }, []);

  useEffect(() => {
    let live = true;
    agentInstallerCatalog().then(
      (loaded) => {
        if (!live) return;
        setCatalog(loaded);
        setCatalogError(null);
      },
      (error: unknown) => {
        if (live)
          setCatalogError(sentence(error, "RIM could not check which agents it can install."));
      },
    );
    let stop: () => void = () => {};
    try {
      stop = onInstallProgress((heard) => {
        if (live) setProgress(heard);
      });
    } catch {
      // Off the desktop app there is nothing to hear; the catalog says why.
    }
    return () => {
      live = false;
      stop();
    };
  }, []);

  const setError = (presetId: string, error: string | null) =>
    setErrors((current) => {
      const { [presetId]: _gone, ...rest } = current;
      return error === null ? rest : { ...rest, [presetId]: error };
    });

  const install = async (preset: AcpPreset) => {
    if (busy) return;
    setBusy({ presetId: preset.id, action: "install" });
    setProgress(null);
    setError(preset.id, null);
    setJustInstalled(null);
    try {
      const outcome = await installAgent(preset.id);
      if (outcome.kind === "installed") {
        const profile = await adoptInstalledAgent(preset, outcome.agent, outcome.replaced);
        if (outcome.replaced === null) {
          setJustInstalled({ presetId: preset.id, profileId: profile.id });
        }
      }
    } catch (error) {
      setError(preset.id, sentence(error, `${preset.name} was not installed.`));
    } finally {
      setBusy(null);
      setProgress(null);
      await load();
    }
  };

  const remove = async (installed: InstalledAgent) => {
    if (busy) return;
    setBusy({ presetId: installed.presetId, action: "remove" });
    setError(installed.presetId, null);
    if (justInstalled?.presetId === installed.presetId) setJustInstalled(null);
    try {
      await removeInstalledAgentFiles(installed);
    } catch (error) {
      setError(installed.presetId, sentence(error, "Its files were not removed."));
    } finally {
      setBusy(null);
      await load();
    }
  };

  return {
    catalog,
    catalogError,
    busy,
    progress,
    errors,
    justInstalled,
    install,
    remove,
    dismissJustInstalled: () => setJustInstalled(null),
  };
}
