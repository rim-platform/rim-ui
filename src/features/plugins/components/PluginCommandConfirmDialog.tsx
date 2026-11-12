import { ShieldAlert } from "lucide-react";

import { Button } from "../../../shared/ui/Button";
import { Dialog } from "../../../shared/ui/Dialog";
import { usePluginConfirmStore } from "../state/usePluginConfirmStore";

const MAX_VALUE_LENGTH = 200;

function formatValue(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}…` : text;
}

/**
 * Asks the user to confirm one run: of a plugin command its manifest marks dangerous, or of
 * one of the app's own commands a plugin asks to run, with the plugin named.
 */
export function PluginCommandConfirmDialog() {
  const request = usePluginConfirmStore((s) => s.request);
  const confirm = usePluginConfirmStore((s) => s.confirm);
  const cancel = usePluginConfirmStore((s) => s.cancel);

  if (!request) return null;
  const args = Object.entries(request.args).filter(([, v]) => v !== undefined && v !== null);
  const asks = request.runsAppCommand;
  const title = asks
    ? `${request.pluginName} wants to run ${request.commandTitle}`
    : `${request.commandTitle}?`;

  return (
    <Dialog open onClose={cancel} title={title} maxWidth="max-w-md">
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rim-danger/15">
            <ShieldAlert className="h-4 w-4 text-rim-danger" />
          </div>
          <div className="min-w-0 space-y-1">
            <p className="text-sm text-rim-text">
              {asks
                ? `The plugin ${request.pluginName} asks to run this RIM command as you. It runs only if you allow it.`
                : `${request.pluginName} marks this command as dangerous. It runs only if you confirm.`}
            </p>
            {request.description && (
              <p className="text-xs text-rim-text-muted">{request.description}</p>
            )}
          </div>
        </div>
        {asks && (
          <p className="text-xs text-rim-text-muted" data-testid="plugin-run-target">
            {asks.target ? `Runs in: ${asks.target}` : "Runs with no conversation open"}
          </p>
        )}
        {args.length > 0 && (
          <dl className="space-y-1 rounded-lg border border-rim-line bg-rim-void px-3 py-2 text-xs">
            {args.map(([name, value]) => (
              <div key={name} className="flex gap-2">
                <dt className="shrink-0 text-rim-text-muted">{name}</dt>
                <dd className="min-w-0 break-all font-mono text-rim-text">{formatValue(value)}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" onClick={cancel}>
            {asks ? "Don't run" : "Cancel"}
          </Button>
          <Button variant="danger" size="sm" onClick={confirm}>
            Run it
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
