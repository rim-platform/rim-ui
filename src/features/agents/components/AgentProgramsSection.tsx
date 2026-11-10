import { useEffect, useMemo, useRef, useState } from "react";

import { detectPlatform } from "../../../core/runtime/runtime";
import { useShellStore } from "../../../shell/state/useShellStore";
import { toast } from "../../../shared/toast";
import { Button } from "../../../shared/ui/Button";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { ConfirmActionDialog } from "../../conversations/components/ConfirmActionDialog";
import { ACP_PRESETS, commandLine, findPreset, type AcpPreset } from "../acp/acpPresets";
import type { InstalledAgent } from "../acp/agentInstaller";
import {
  addAgentProgram,
  removeAgentProgram,
  resolveStoredPrograms,
  startsPair,
} from "../acp/agentPrograms";
import { DESKTOP_ONLY_MESSAGE } from "../acp/agentRunner";
import { showInvisibleCharacters } from "../runtime/invisibleCharacters";
import { useAgentProgramsStore, type AgentProgramProfile } from "../state/useAgentProgramsStore";
import { AgentCatalogList } from "./AgentCatalogList";
import { AgentProgramDialog, type AgentProgramDialogTarget } from "./AgentProgramDialog";
import { AgentSignInDialog } from "./AgentSignInDialog";
import { isBareName, programState, useFound, type ProgramState } from "./programLookup";
import { useAgentInstaller } from "./useAgentInstaller";

/** What the section says about what RIM starts. */
export const PROGRAMS_NOTE =
  "RIM starts these programs as you, with access to your files. Each one is asked about in a system dialog first.";

/** The toast when a removed program could not be taken off the allowed list. */
export const FORGET_FAILED = "RIM could not forget that it may start this program.";

const STATE_LABELS: Record<Exclude<ProgramState, "unknown">, string> = {
  found: "Found",
  not_found: "Not found",
  add_again: "Not found, add it again",
};

/**
 * Settings > Agents, Agents RIM can start: the supported agents, which RIM can install, and the
 * agent programs RIM may start, with adding more and signing in to them.
 */
export function AgentProgramsSection() {
  if (detectPlatform() !== "desktop") {
    return (
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-rim-text">Agents RIM can start</h2>
        <p className="text-sm text-rim-text-muted">{DESKTOP_ONLY_MESSAGE}</p>
      </div>
    );
  }
  return <ProgramList />;
}

function ProgramList() {
  const profiles = useAgentProgramsStore((s) => s.profiles);
  const [dialog, setDialog] = useState<AgentProgramDialogTarget | null>(null);
  const [removing, setRemoving] = useState<AgentProgramProfile | null>(null);
  const [removingFiles, setRemovingFiles] = useState<{
    preset: AcpPreset;
    installed: InstalledAgent;
  } | null>(null);
  const [signingIn, setSigningIn] = useState<AgentProgramProfile | null>(null);
  const installer = useAgentInstaller();
  const installedPairs = useMemo(
    () =>
      (installer.catalog?.agents ?? []).flatMap((entry) =>
        entry.installed ? [entry.installed] : [],
      ),
    [installer.catalog],
  );
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const names = useMemo(() => {
    const all = [...ACP_PRESETS.map((preset) => preset.program), ...profiles.map((p) => p.program)];
    return [...new Set(all.filter(isBareName))].sort();
  }, [profiles]);
  const found = useFound(names);
  const unresolved = profiles.some((profile) => profile.resolvedProgram === null);

  useEffect(() => {
    if (unresolved) void resolveStoredPrograms();
  }, [unresolved]);

  const addInstalled = (preset: AcpPreset, installed: InstalledAgent) => {
    addAgentProgram({
      name: preset.name,
      program: installed.program,
      args: installed.args,
      defaultFolder: null,
      presetId: preset.id,
    }).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : `${preset.name} was not added.`);
    });
  };

  const menuItems = [
    ...ACP_PRESETS.map((preset) => ({
      id: preset.id,
      label: preset.name,
      detail: found.get(preset.program) === null ? "Not found" : undefined,
      onSelect: () =>
        setDialog({
          mode: "add",
          preset,
          found: found.has(preset.program) ? found.get(preset.program) != null : null,
        }),
    })),
    {
      id: "custom",
      label: "Custom…",
      separatorBefore: true,
      onSelect: () => setDialog({ mode: "add", preset: null, found: null }),
    },
  ];

  return (
    <section aria-labelledby="agent-programs-heading" className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="agent-programs-heading" className="text-base font-semibold text-rim-text">
            Agents RIM can start
          </h2>
          <p className="mt-1 text-sm text-rim-text-muted">{PROGRAMS_NOTE}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => useShellStore.getState().setMainSurface({ kind: "agent-sessions" })}
          >
            Open agent sessions
          </Button>
          <Button
            ref={addRef}
            type="button"
            variant="secondary"
            size="sm"
            aria-haspopup="menu"
            aria-expanded={menuAt !== null}
            onClick={() => {
              if (menuAt) {
                setMenuAt(null);
                return;
              }
              const rect = addRef.current?.getBoundingClientRect();
              setMenuAt({ x: rect?.left ?? 0, y: rect?.bottom ?? 0 });
            }}
          >
            Add
          </Button>
        </div>
      </div>

      <AgentCatalogList
        installer={installer}
        found={found}
        profiles={profiles}
        onAddFound={(preset) =>
          setDialog({ mode: "add", preset, found: found.get(preset.program) != null })
        }
        onAddInstalled={addInstalled}
        onRemoveFiles={(preset, installed) => setRemovingFiles({ preset, installed })}
        onSignIn={setSigningIn}
      />

      <h3 className="pt-2 text-sm font-medium text-rim-text">Your agent programs</h3>
      {profiles.length === 0 ? (
        <p className="text-sm text-rim-text-muted">
          None yet. Install one above, or choose Add for one you installed yourself or another
          program that speaks the Agent Client Protocol.
        </p>
      ) : (
        <ul aria-label="Your agent programs" className="space-y-2">
          {profiles.map((profile) => (
            <ProgramRow
              key={profile.id}
              profile={profile}
              found={programState(profile, found)}
              installed={
                profile.resolvedProgram !== null &&
                installedPairs.some((pair) => startsPair(profile, pair))
              }
              onEdit={() => setDialog({ mode: "edit", profile })}
              onRemove={() => setRemoving(profile)}
              onSignIn={() => setSigningIn(profile)}
            />
          ))}
        </ul>
      )}

      {menuAt && (
        <DropdownMenu
          label="Add an agent RIM can start"
          position={menuAt}
          anchorRef={addRef}
          closeOnSelect
          onClose={() => setMenuAt(null)}
          items={menuItems}
        />
      )}

      {dialog && <AgentProgramDialog target={dialog} onClose={() => setDialog(null)} />}

      {signingIn && <AgentSignInDialog profile={signingIn} onClose={() => setSigningIn(null)} />}

      {removingFiles && (
        <ConfirmActionDialog
          title={`Remove ${removingFiles.preset.name}'s files from this computer?`}
          description={`Its sessions stop working until you install it again. RIM also stops starting it and disconnects the agent it made for it.`}
          confirmLabel="Remove files"
          danger
          onConfirm={() => {
            const { installed } = removingFiles;
            setRemovingFiles(null);
            void installer.remove(installed);
          }}
          onClose={() => setRemovingFiles(null)}
        />
      )}

      {removing && (
        <ConfirmActionDialog
          title={`Remove ${showInvisibleCharacters(removing.name)}?`}
          description="RIM won't start it any more, and disconnects the agent it made for it. What the agent has already read stays with it."
          confirmLabel="Remove"
          danger
          onConfirm={() => {
            const id = removing.id;
            setRemoving(null);
            void removeAgentProgram(id).then((forgotten) => {
              if (!forgotten) toast.error(FORGET_FAILED);
            });
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </section>
  );
}

function ProgramRow({
  profile,
  found,
  installed,
  onEdit,
  onRemove,
  onSignIn,
}: {
  profile: AgentProgramProfile;
  found: ProgramState;
  /** Whether RIM installed the program it starts. */
  installed: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onSignIn: () => void;
}) {
  const name = showInvisibleCharacters(profile.name);
  const preset = findPreset(profile.presetId);
  const canSignIn = preset !== undefined && (installed || found === "found");
  return (
    <li className="rounded-lg border border-rim-line bg-rim-panel px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-48 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="break-words text-sm font-medium text-rim-text">{name}</span>
            {installed && (
              <span className="rounded-full border border-rim-success/30 px-2 text-xs text-rim-success">
                Installed by RIM
              </span>
            )}
            {found !== "unknown" && (
              <span
                className={
                  found === "found"
                    ? "rounded-full border border-rim-success/30 px-2 text-xs text-rim-success"
                    : "rounded-full border border-rim-warm/30 px-2 text-xs text-rim-warm"
                }
              >
                {STATE_LABELS[found]}
              </span>
            )}
          </div>
          <code className="block whitespace-pre-wrap break-all font-mono text-xs text-rim-text">
            {commandLine(profile.program, profile.args)}
          </code>
          <span className="block break-all text-xs text-rim-text-muted">
            {profile.defaultFolder ? `Starts in ${profile.defaultFolder}` : "No default folder"}
          </span>
        </div>
        <div className="flex shrink-0 gap-2">
          {canSignIn && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-label={`Sign in to ${name}`}
              onClick={onSignIn}
            >
              Sign in
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-label={`Edit ${name}`}
            onClick={onEdit}
          >
            Edit
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-label={`Remove ${name}`}
            onClick={onRemove}
          >
            Remove
          </Button>
        </div>
      </div>
      {found === "not_found" && preset && (
        <p className="mt-3 border-t border-rim-line pt-3 text-xs text-rim-text-muted">
          RIM can&apos;t find {profile.program} on this computer. Install {preset.name} above, or
          choose Edit to point at the one you installed.
        </p>
      )}
    </li>
  );
}
