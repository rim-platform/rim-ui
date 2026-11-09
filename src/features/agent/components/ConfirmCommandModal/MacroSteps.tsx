import { useMemo } from "react";

import { showInvisibleCharacters } from "../../../agents/runtime/invisibleCharacters";
import { useAccountMacros } from "../../../macros/api/useAccountMacros";
import { useMacroRegistry } from "../../../macros/api/useMacroCommands";
import { isMacroId, stepTitle } from "../../../macros/runtime/macroCommands";
import { formatArgValue, maskForDisplay } from "./argsMasker";

function argsOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * The steps of the person's macro `commandId` names, in the order they run, each with its
 * command's title and the arguments fixed for it, secrets masked. Nothing while the macro is not
 * one of the person's macros, or the home server keeps no macros of its own.
 */
export function MacroSteps({ commandId }: { commandId: string }) {
  const registry = useMacroRegistry();
  const { data: macros } = useAccountMacros();
  const macro = useMemo(
    () => (isMacroId(commandId) ? macros?.find((m) => m.id === commandId) : undefined),
    [commandId, macros],
  );
  if (!registry || !macro) return null;
  return (
    <div data-testid="macro-steps">
      <div className="my-2 flex items-center gap-2 text-[10px] uppercase tracking-wide text-rim-text-faint">
        <span className="h-px flex-1 bg-rim-line" />
        <span>The macro&apos;s steps</span>
        <span className="h-px flex-1 bg-rim-line" />
      </div>
      <ol className="space-y-1.5 text-sm">
        {macro.steps.map((step, i) => {
          const args = Object.entries(maskForDisplay(argsOf(step.args)));
          return (
            <li key={i} data-testid="macro-step">
              <div className="break-words text-rim-text">
                {i + 1}. {showInvisibleCharacters(stepTitle(step.commandId, registry))}
                {isMacroId(step.commandId) && (
                  <span className="text-xs text-rim-text-muted"> (another macro)</span>
                )}
              </div>
              {args.length > 0 && (
                <dl className="ml-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 font-mono text-xs">
                  {args.map(([name, value]) => (
                    <div key={name} className="contents">
                      <dt className="break-words text-rim-text-muted">
                        {showInvisibleCharacters(name)}
                      </dt>
                      <dd className="break-words text-rim-text">
                        {showInvisibleCharacters(formatArgValue(value))}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {step.ask.length > 0 && (
                <div className="ml-4 text-xs text-rim-text-muted">
                  Asks when it runs: {step.ask.map(showInvisibleCharacters).join(", ")}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
