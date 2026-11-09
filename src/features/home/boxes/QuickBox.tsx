import { useId } from "react";

import { runCommandFromClick } from "../../commands/runtime/runFromClick";
import { actionTitle, useResolvedActions, type ResolvedAction } from "./quickActions";
import type { QuickAction, QuickSettings } from "./settings";

/** One action: a button running its command, or a disabled one with why it can't run here. */
function ActionButton({
  resolved,
  onRun,
}: {
  resolved: ResolvedAction;
  onRun: (action: QuickAction) => void;
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
  const { action } = resolved;
  return (
    <li>
      <button
        type="button"
        onClick={() => onRun(action)}
        className="rounded-lg border border-rim-line-strong px-3 py-1.5 text-sm text-rim-text transition hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rim-accent"
      >
        {title}
      </button>
    </li>
  );
}

/**
 * Buttons that run commands as the palette runs them, with the action's saved arguments: a
 * command that asks for confirmation still asks, the argument form asks for what is missing, and
 * the outcome shows as the palette shows it.
 */
export function QuickBoxBody({ settings }: { settings: QuickSettings }) {
  const resolved = useResolvedActions(settings.actions);

  return (
    <ul className="flex flex-wrap items-start gap-2" aria-label="Quick actions">
      {resolved.map((entry, index) => (
        <ActionButton
          key={`${entry.action.commandId}:${index}`}
          resolved={entry}
          onRun={(action) =>
            void runCommandFromClick(action.commandId, action.presetArgs, { savedArgs: true })
          }
        />
      ))}
    </ul>
  );
}
