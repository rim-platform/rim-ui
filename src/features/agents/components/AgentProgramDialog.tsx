import { useId, useState } from "react";

import { Button } from "../../../shared/ui/Button";
import { copyToClipboard } from "../../../shared/ui/contextMenu/menuActions";
import { Dialog } from "../../../shared/ui/Dialog";
import type { AcpPreset, PresetHint } from "../acp/acpPresets";
import { addAgentProgram, editAgentProgram, parseArgsText } from "../acp/agentPrograms";
import type { AgentProgramProfile } from "../state/useAgentProgramsStore";

const FIELD_CLASS =
  "w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2.5 text-sm text-rim-text outline-none transition placeholder:text-rim-text-faint focus:border-rim-accent/40";
const LABEL_CLASS = "mb-1 block text-xs font-medium uppercase tracking-wider text-rim-text-faint";

/** What the person sees when the native dialog was answered Don't allow. */
export const REFUSED_LINE = "Not allowed, so nothing was saved.";

/** A hint with its command in a box and a Copy button. */
export function HintLine({ hint, label }: { hint: PresetHint; label: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-rim-text-muted">{hint.text}</p>
      {hint.command !== null && (
        <div className="flex items-start gap-2">
          <code className="min-w-0 flex-1 whitespace-pre-wrap break-all rounded-lg border border-rim-line bg-rim-void px-3 py-1.5 font-mono text-xs text-rim-text">
            {hint.command}
          </code>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-label={`Copy ${label}`}
            onClick={() => copyToClipboard(hint.command ?? "")}
          >
            Copy
          </Button>
        </div>
      )}
    </div>
  );
}

/** What the dialog adds or changes. */
export type AgentProgramDialogTarget =
  | { mode: "add"; preset: AcpPreset | null; found: boolean | null }
  | { mode: "edit"; profile: AgentProgramProfile };

/**
 * Adds an agent program, from a preset or custom, or changes one. Saving asks in the system's
 * own dialog first whenever the program or its arguments are new.
 */
export function AgentProgramDialog({
  target,
  onClose,
}: {
  target: AgentProgramDialogTarget;
  onClose: () => void;
}) {
  const start =
    target.mode === "edit"
      ? target.profile
      : {
          name: target.preset?.name ?? "",
          program: target.preset?.program ?? "",
          args: target.preset?.args ?? [],
          defaultFolder: null,
        };
  const [name, setName] = useState(start.name);
  const [program, setProgram] = useState(start.program);
  const [argsText, setArgsText] = useState(start.args.join("\n"));
  const [folder, setFolder] = useState(start.defaultFolder ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const baseId = useId();
  const preset = target.mode === "add" ? target.preset : null;
  const notFound = target.mode === "add" && target.found === false && preset !== null;
  const title =
    target.mode === "edit"
      ? `Edit ${target.profile.name}`
      : preset
        ? `Add ${preset.name}`
        : "Add a custom agent";

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const args = parseArgsText(argsText);
    try {
      if (target.mode === "edit") {
        const outcome = await editAgentProgram(target.profile.id, {
          name,
          program,
          args,
          defaultFolder: folder,
        });
        if (outcome === "refused") setProblem(REFUSED_LINE);
        else onClose();
      } else {
        const added = await addAgentProgram({
          name,
          program,
          args,
          defaultFolder: folder,
          presetId: preset?.id ?? null,
        });
        if (added === null) setProblem(REFUSED_LINE);
        else onClose();
      }
    } catch (error) {
      setProblem(
        error instanceof Error && error.message !== "" ? error.message : "That did not work.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open title={title} maxWidth="max-w-lg" onClose={busy ? () => {} : onClose}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {notFound && (
          <div className="space-y-2 rounded-lg border border-rim-line bg-rim-panel px-3 py-2">
            <p className="text-sm text-rim-text">
              {preset.program} is not found on this computer. RIM never installs agents.
            </p>
            <HintLine hint={preset.install} label="install command" />
            <HintLine hint={preset.signIn} label="sign-in command" />
          </div>
        )}
        <label className="block">
          <span className={LABEL_CLASS}>Name</span>
          <input
            type="text"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Claude Code"
            className={FIELD_CLASS}
          />
        </label>
        <label className="block">
          <span className={LABEL_CLASS}>Program</span>
          <input
            type="text"
            value={program}
            onChange={(event) => setProgram(event.target.value)}
            placeholder="claude-agent-acp"
            spellCheck={false}
            className={`${FIELD_CLASS} font-mono`}
          />
          <span className="mt-1 block text-xs text-rim-text-muted">
            A full path, or a name RIM finds on your PATH.
          </span>
        </label>
        <label className="block">
          <span className={LABEL_CLASS}>Arguments</span>
          <textarea
            rows={3}
            value={argsText}
            onChange={(event) => setArgsText(event.target.value)}
            spellCheck={false}
            className={`${FIELD_CLASS} resize-y font-mono`}
          />
          <span className="mt-1 block text-xs text-rim-text-muted">One per line.</span>
        </label>
        <label className="block">
          <span className={LABEL_CLASS}>Default folder</span>
          <input
            type="text"
            value={folder}
            onChange={(event) => setFolder(event.target.value)}
            placeholder="/home/you/project"
            spellCheck={false}
            className={`${FIELD_CLASS} font-mono`}
          />
          <span className="mt-1 block text-xs text-rim-text-muted">
            Optional. The folder&apos;s full path, where sessions start unless you pick another.
          </span>
        </label>
        <p className="text-xs text-rim-text-muted">
          Saving asks in a system dialog whether RIM may start this program with these arguments.
        </p>
        {problem !== null && (
          <p id={`${baseId}-problem`} role="alert" className="text-sm text-rim-danger">
            {problem}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={busy}>
            {target.mode === "edit" ? "Save" : "Add"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
