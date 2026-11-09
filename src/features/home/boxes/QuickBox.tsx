import { useId } from "react";

import { useExecuteCommandMutation } from "../../commands/api/useCommands";
import { currentCommandContext } from "../../commands/runtime/commandContext";
import { dispatchCommand } from "../../commands/runtime/commandDispatcher";
import { showCommandOutcome } from "../../commands/runtime/commandOutcome";
import { showCommandRefusal } from "../../commands/runtime/refusal";
import type { CommandDefinition } from "../../commands/types";
import { actionTitle, useResolvedActions, type ResolvedAction } from "./quickActions";
import type { QuickAction, QuickSettings } from "./settings";

/** One action: a button running its command, or a disabled one with why it can't run here. */
function ActionButton({
  resolved,
  onRun,
}: {
  resolved: ResolvedAction;
  onRun: (command: CommandDefinition, action: QuickAction) => void;
}) {
  const reasonId = useId();
  const title = actionTitle(resolved);
  if (!resolved.command) {
    return (
      <li className="flex flex-col gap-0.5">
        <button
          type="button"
          disabled
          aria-describedby={reasonId}
          className="rounded-lg border border-rim-line px-3 py-1.5 text-left text-sm text-rim-text-faint"
        >
          {title}
        </button>
        <span id={reasonId} className="text-xs text-rim-text-faint">
          {resolved.reason}
        </span>
      </li>
    );
  }
  const { command, action } = resolved;
  return (
    <li>
      <button
        type="button"
        onClick={() => onRun(command, action)}
        className="rounded-lg border border-rim-line-strong px-3 py-1.5 text-sm text-rim-text transition hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rim-accent"
      >
        {title}
      </button>
    </li>
  );
}

/**
 * Buttons that run commands, each as a click from the person runs it from the palette: through
 * the dispatcher, so a command that asks for confirmation still asks, and its outcome shows as
 * the palette shows it.
 */
export function QuickBoxBody({ settings }: { settings: QuickSettings }) {
  const resolved = useResolvedActions(settings.actions);
  const execute = useExecuteCommandMutation();

  async function run(command: CommandDefinition, args: Record<string, unknown> | undefined) {
    const commandContext = currentCommandContext();
    // The arguments it ran with, with any the argument form asked for.
    let ranWith = args;
    try {
      const result = await dispatchCommand(command, (input) => execute.mutateAsync(input), {
        args,
        commandContext,
        askForArguments: true,
        onArguments: (filled) => {
          ranWith = filled;
        },
      });
      await showCommandOutcome(command, result, ranWith, commandContext);
    } catch (err) {
      showCommandRefusal(command.title, err, () => void run(command, ranWith));
    }
  }

  return (
    <ul className="flex flex-wrap items-start gap-2" aria-label="Quick actions">
      {resolved.map((entry, index) => (
        <ActionButton
          key={`${entry.action.commandId}:${index}`}
          resolved={entry}
          onRun={(command, action) => void run(command, action.presetArgs)}
        />
      ))}
    </ul>
  );
}
