import { useEffect, useMemo, useRef, useState } from "react";

import { detectPlatform } from "../../../core/runtime/runtime";
import { toast } from "../../../shared/toast";
import { Button } from "../../../shared/ui/Button";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { ConfirmActionDialog } from "../../conversations/components/ConfirmActionDialog";
import { ACP_PRESETS, commandLine, findPreset } from "../acp/acpPresets";
import { removeAgentProgram } from "../acp/agentPrograms";
import { DESKTOP_ONLY_MESSAGE, findAgentPrograms } from "../acp/agentRunner";
import { showInvisibleCharacters } from "../runtime/invisibleCharacters";
import { useAgentProgramsStore, type AgentProgramProfile } from "../state/useAgentProgramsStore";
import { AgentProgramDialog, HintLine, type AgentProgramDialogTarget } from "./AgentProgramDialog";

/** What the section says about what RIM starts. */
export const PROGRAMS_NOTE =
  "RIM starts these programs as you, with access to your files. Each one is asked about in a system dialog first.";

/** The toast when a removed program could not be taken off the allowed list. */
export const FORGET_FAILED = "RIM could not forget that it may start this program.";

/** Whether `program` is a bare name, which can be looked up. */
function isBareName(program: string): boolean {
  return program !== "" && !/[\\/]/u.test(program);
}

/**
 * Looks the programs up on the computer's `PATH`.
 *
 * @returns Each bare name and whether it was found; full paths are left out. Empty when the
 *   lookup fails.
 */
function useFound(names: string[]): Map<string, boolean> {
  const key = names.join("\n");
  const [found, setFound] = useState<Map<string, boolean>>(() => new Map());
  useEffect(() => {
    const wanted = key === "" ? [] : key.split("\n");
    if (wanted.length === 0) return;
    let live = true;
    findAgentPrograms(wanted)
      .then((paths) => {
        if (!live) return;
        setFound(new Map(wanted.map((name, index) => [name, paths[index] != null])));
      })
      .catch(() => {
        if (live) setFound(new Map());
      });
    return () => {
      live = false;
    };
  }, [key]);
  return found;
}

/** Settings > Agents, Agents RIM can start: the agent programs RIM may start, and adding more. */
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
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const names = useMemo(() => {
    const all = [...ACP_PRESETS.map((preset) => preset.program), ...profiles.map((p) => p.program)];
    return [...new Set(all.filter(isBareName))].sort();
  }, [profiles]);
  const found = useFound(names);

  const menuItems = [
    ...ACP_PRESETS.map((preset) => ({
      id: preset.id,
      label: preset.name,
      detail: found.get(preset.program) === false ? "Not found" : undefined,
      onSelect: () => setDialog({ mode: "add", preset, found: found.get(preset.program) ?? null }),
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

      {profiles.length === 0 ? (
        <p className="text-sm text-rim-text-muted">
          None yet. Add Claude Code, Codex, Gemini CLI, opencode, Goose or another program that
          speaks the Agent Client Protocol.
        </p>
      ) : (
        <ul className="space-y-2">
          {profiles.map((profile) => (
            <ProgramRow
              key={profile.id}
              profile={profile}
              found={isBareName(profile.program) ? found.get(profile.program) : undefined}
              onEdit={() => setDialog({ mode: "edit", profile })}
              onRemove={() => setRemoving(profile)}
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
  onEdit,
  onRemove,
}: {
  profile: AgentProgramProfile;
  /** Whether the program was found, or `undefined` when unknown or a full path. */
  found: boolean | undefined;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const name = showInvisibleCharacters(profile.name);
  const preset = findPreset(profile.presetId);
  return (
    <li className="rounded-lg border border-rim-line bg-rim-panel px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-48 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="break-words text-sm font-medium text-rim-text">{name}</span>
            {found !== undefined && (
              <span
                className={
                  found
                    ? "rounded-full border border-rim-success/30 px-2 text-xs text-rim-success"
                    : "rounded-full border border-rim-warm/30 px-2 text-xs text-rim-warm"
                }
              >
                {found ? "Found" : "Not found"}
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
      {found === false && preset && (
        <div className="mt-3 space-y-2 border-t border-rim-line pt-3">
          <HintLine hint={preset.install} label="install command" />
          <HintLine hint={preset.signIn} label="sign-in command" />
        </div>
      )}
    </li>
  );
}
