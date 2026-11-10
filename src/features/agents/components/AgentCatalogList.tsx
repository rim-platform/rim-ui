import { Button } from "../../../shared/ui/Button";
import { ACP_PRESETS, type AcpPreset } from "../acp/acpPresets";
import { progressLine, type InstalledAgent } from "../acp/agentInstaller";
import type { AgentProgramProfile } from "../state/useAgentProgramsStore";
import { presetRowState, versionLine, type PresetRowState } from "./catalogRows";
import type { AgentInstallerState } from "./useAgentInstaller";

const CHIP_SUCCESS = "rounded-full border border-rim-success/30 px-2 text-xs text-rim-success";

/**
 * The supported agents, one row each: installing, updating and removing what RIM installs, and
 * one the person installed themselves.
 */
export function AgentCatalogList({
  installer,
  found,
  profiles,
  onAddFound,
  onAddInstalled,
  onRemoveFiles,
  onSignIn,
}: {
  installer: AgentInstallerState;
  found: Map<string, string | null>;
  profiles: readonly AgentProgramProfile[];
  /** Adds a profile for the preset's program found on the `PATH`. */
  onAddFound: (preset: AcpPreset) => void;
  /** Adds a profile again for an agent RIM installed that no profile starts. */
  onAddInstalled: (preset: AcpPreset, installed: InstalledAgent) => void;
  /** Asks before removing an installed agent's files. */
  onRemoveFiles: (preset: AcpPreset, installed: InstalledAgent) => void;
  onSignIn: (profile: AgentProgramProfile) => void;
}) {
  const loaded = installer.catalog !== null || installer.catalogError !== null;
  return (
    <div className="space-y-2">
      {installer.catalogError !== null && (
        <p role="alert" className="text-sm text-rim-danger">
          {installer.catalogError}
        </p>
      )}
      <ul aria-label="Supported agents" className="space-y-2">
        {ACP_PRESETS.map((preset) => {
          const entry = installer.catalog?.find((item) => item.presetId === preset.id);
          const state = presetRowState(
            preset,
            entry,
            loaded,
            found.has(preset.program) ? found.get(preset.program) : undefined,
            profiles,
          );
          const just =
            installer.justInstalled?.presetId === preset.id
              ? profiles.find((profile) => profile.id === installer.justInstalled?.profileId)
              : undefined;
          return (
            <PresetRow
              key={preset.id}
              preset={preset}
              state={state}
              installer={installer}
              justInstalled={just}
              onAddFound={() => onAddFound(preset)}
              onAddInstalled={(installed) => onAddInstalled(preset, installed)}
              onRemoveFiles={(installed) => onRemoveFiles(preset, installed)}
              onSignIn={onSignIn}
            />
          );
        })}
      </ul>
    </div>
  );
}

function PresetRow({
  preset,
  state,
  installer,
  justInstalled,
  onAddFound,
  onAddInstalled,
  onRemoveFiles,
  onSignIn,
}: {
  preset: AcpPreset;
  state: PresetRowState;
  installer: AgentInstallerState;
  justInstalled: AgentProgramProfile | undefined;
  onAddFound: () => void;
  onAddInstalled: (installed: InstalledAgent) => void;
  onRemoveFiles: (installed: InstalledAgent) => void;
  onSignIn: (profile: AgentProgramProfile) => void;
}) {
  const { busy, progress } = installer;
  const mine = busy?.presetId === preset.id;
  const error = installer.errors[preset.id];
  const installing = mine && busy?.action === "install";
  const heard = progress?.presetId === preset.id ? progress : null;
  const progressText = !installing
    ? null
    : heard === null
      ? "Starting…"
      : (progressLine(heard) ?? "Finishing…");
  return (
    <li className="rounded-lg border border-rim-line bg-rim-panel px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-48 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-rim-text">{preset.name}</span>
            {state.kind === "installed" && (
              <span className={CHIP_SUCCESS}>Installed by RIM, {state.installed.version}</span>
            )}
            {state.kind === "found" && <span className={CHIP_SUCCESS}>Found on this computer</span>}
          </div>
          {state.kind === "install" && (
            <>
              <span className="block text-xs text-rim-text-muted">
                {versionLine(state.available)}
              </span>
              <span className="block break-all text-xs text-rim-text-faint">
                From {state.available.source}
              </span>
            </>
          )}
          {state.kind === "installed" && state.update && (
            <span className="block text-xs text-rim-text-muted">
              {versionLine(state.update)} is available
            </span>
          )}
          {state.kind === "installed" && !state.profile && (
            <span className="block text-xs text-rim-text-muted">
              RIM doesn&apos;t start it now. Add it to use it again.
            </span>
          )}
          {state.kind === "unavailable" && (
            <>
              <span className="block text-xs text-rim-text-muted">
                Not available on this computer
              </span>
              {state.problem !== null && (
                <span className="block text-xs text-rim-warm">{state.problem}</span>
              )}
            </>
          )}
          {state.kind === "checking" && (
            <span className="block text-xs text-rim-text-muted">Checking…</span>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {state.kind === "install" && (
            <Button
              type="button"
              size="sm"
              isLoading={installing}
              disabled={busy !== null}
              aria-label={`Install ${preset.name}`}
              onClick={() => void installer.install(preset)}
            >
              Install
            </Button>
          )}
          {state.kind === "found" && !state.profile && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              aria-label={`Add ${preset.name}`}
              onClick={onAddFound}
            >
              Add
            </Button>
          )}
          {state.kind === "installed" && !state.profile && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy !== null}
              aria-label={`Add ${preset.name}`}
              onClick={() => onAddInstalled(state.installed)}
            >
              Add
            </Button>
          )}
          {state.kind === "installed" && state.update && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              isLoading={installing}
              disabled={busy !== null}
              aria-label={`Update ${preset.name} to ${state.update.version}`}
              onClick={() => void installer.install(preset)}
            >
              Update to {state.update.version}
            </Button>
          )}
          {state.kind === "installed" && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              isLoading={mine && busy?.action === "remove"}
              disabled={busy !== null}
              aria-label={`Remove ${preset.name}'s files`}
              onClick={() => onRemoveFiles(state.installed)}
            >
              Remove files
            </Button>
          )}
        </div>
      </div>
      {progressText !== null && (
        <p role="status" className="mt-2 text-xs text-rim-text-muted">
          {progressText}
        </p>
      )}
      {error !== undefined && (
        <p role="alert" className="mt-2 text-sm text-rim-danger">
          {error}
        </p>
      )}
      {justInstalled && (
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-rim-line pt-3">
          <p className="min-w-0 flex-[1_1_16rem] text-sm text-rim-text">
            {preset.name} is installed. Sign in once so it can work.
          </p>
          <Button
            type="button"
            size="sm"
            aria-label={`Sign in to ${preset.name}`}
            onClick={() => {
              installer.dismissJustInstalled();
              onSignIn(justInstalled);
            }}
          >
            Sign in
          </Button>
        </div>
      )}
    </li>
  );
}
