import { useEffect, useId, useMemo, useState } from "react";

import { Button } from "../../../../shared/ui/Button";
import { cn } from "../../../../shared/ui/cn";
import { Dialog } from "../../../../shared/ui/Dialog";
import { commandLine } from "../../acp/acpPresets";
import { isFullPath, resolveStoredPrograms } from "../../acp/agentPrograms";
import { ADD_AGAIN } from "../../acp/agentSession";
import { showInvisibleCharacters } from "../../runtime/invisibleCharacters";
import { useAgentProgramsStore, type AgentProgramProfile } from "../../state/useAgentProgramsStore";
import { startAgentSession } from "../../state/useAgentSessionsStore";
import { useStartAgentSessionStore } from "../../state/useStartAgentSessionStore";
import { isBareName, programState, useFound } from "../programLookup";
import {
  ADD_PROGRAM_FIRST,
  FOLDER_NEEDED,
  openAgentSession,
  openAgentsSettings,
  sandboxSentence,
} from "./sessionText";

const FIELD_CLASS =
  "w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2.5 text-sm text-rim-text outline-none transition placeholder:text-rim-text-faint focus:border-rim-accent/40";
const LABEL_CLASS = "mb-1 block text-xs font-medium uppercase tracking-wider text-rim-text-faint";

/** The start dialog, while it is open. */
export function StartAgentSessionDialogHost() {
  const open = useStartAgentSessionStore((s) => s.open);
  const close = useStartAgentSessionStore((s) => s.close);
  if (!open) return null;
  return <StartAgentSessionDialog onClose={close} />;
}

/** Why a profile can't start, or `null` when it can as far as RIM knows. */
function unavailable(
  profile: AgentProgramProfile,
  found: Map<string, string | null>,
): string | null {
  const state = programState(profile, found);
  if (state === "add_again") return ADD_AGAIN;
  if (state === "not_found") return `${profile.program} is not found on this computer.`;
  return null;
}

/** Picks an agent program and a folder, and starts a session there. */
export function StartAgentSessionDialog({ onClose }: { onClose: () => void }) {
  const profiles = useAgentProgramsStore((s) => s.profiles);
  const names = useMemo(
    () => [...new Set(profiles.map((profile) => profile.program).filter(isBareName))].sort(),
    [profiles],
  );
  const found = useFound(names);
  const unresolved = profiles.some((profile) => profile.resolvedProgram === null);
  useEffect(() => {
    if (unresolved) void resolveStoredPrograms();
  }, [unresolved]);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const baseId = useId();

  const usable = profiles.filter((profile) => unavailable(profile, found) === null);
  const chosen = usable.find((profile) => profile.id === chosenId) ?? usable[0] ?? null;
  const folderValue = folder ?? chosen?.defaultFolder ?? "";

  const start = () => {
    if (!chosen) return;
    const path = folderValue.trim();
    if (!isFullPath(path)) {
      setProblem(FOLDER_NEEDED);
      return;
    }
    const key = startAgentSession(chosen, path);
    const { onStarted } = useStartAgentSessionStore.getState();
    onClose();
    openAgentSession(key);
    onStarted?.(key);
  };

  return (
    <Dialog open title="Start an agent session" maxWidth="max-w-lg" onClose={onClose}>
      {profiles.length === 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-rim-text-muted">{ADD_PROGRAM_FIRST}</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                onClose();
                openAgentsSettings();
              }}
            >
              Open Settings → Agents
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            start();
          }}
        >
          <fieldset className="space-y-1">
            <legend className={LABEL_CLASS}>Agent</legend>
            {profiles.map((profile) => {
              const reason = unavailable(profile, found);
              const id = `${baseId}-${profile.id}`;
              return (
                <label
                  key={profile.id}
                  htmlFor={id}
                  className={cn(
                    "flex items-start gap-2 rounded-lg border border-rim-line px-3 py-2",
                    reason ? "opacity-60" : "cursor-pointer hover:bg-rim-panel-soft",
                  )}
                >
                  <input
                    id={id}
                    type="radio"
                    name={`${baseId}-agent`}
                    className="mt-1"
                    disabled={reason !== null}
                    checked={chosen?.id === profile.id}
                    onChange={() => {
                      setChosenId(profile.id);
                      setFolder(null);
                      setProblem(null);
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-rim-text">
                      {showInvisibleCharacters(profile.name)}
                    </span>
                    <code className="block truncate font-mono text-xs text-rim-text-muted">
                      {commandLine(profile.program, profile.args)}
                    </code>
                    {reason && <span className="block text-xs text-rim-warm">{reason}</span>}
                  </span>
                </label>
              );
            })}
          </fieldset>
          <label className="block">
            <span className={LABEL_CLASS}>Folder</span>
            <input
              type="text"
              value={folderValue}
              onChange={(event) => {
                setFolder(event.target.value);
                setProblem(null);
              }}
              placeholder="/home/you/project"
              spellCheck={false}
              aria-invalid={problem !== null}
              aria-describedby={problem !== null ? `${baseId}-problem` : undefined}
              className={`${FIELD_CLASS} font-mono`}
            />
            <span className="mt-1 block text-xs text-rim-text-muted">
              The full path of the folder the agent works in.
            </span>
          </label>
          <p className="text-xs text-rim-text-muted">
            {sandboxSentence(folderValue.trim() !== "" ? folderValue.trim() : "that folder")}
          </p>
          {problem !== null && (
            <p id={`${baseId}-problem`} role="alert" className="text-sm text-rim-danger">
              {problem}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={chosen === null}>
              Start
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
