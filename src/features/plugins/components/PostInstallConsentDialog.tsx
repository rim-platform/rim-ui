import { AlertTriangle, Terminal } from "lucide-react";

import { Dialog } from "../../../shared/ui/Dialog";
import { Button } from "../../../shared/ui/Button";
import type { PostInstallConsentRequest } from "../types";

interface PostInstallConsentDialogProps {
  request: PostInstallConsentRequest;
  /** True while the consented retry is running. */
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Dangerous-action confirmation shown when a git plugin needs dependency
 * install steps (S-H3). Names every command verbatim, with its working
 * directory, and states that it runs the plugin author's code with the user's
 * privileges. Cancel is the safe default; Esc/backdrop/close all cancel.
 *
 * Content is rendered as plain React text — never as HTML — so a hostile
 * plugin id or path cannot inject markup into this trust surface.
 */
export function PostInstallConsentDialog({
  request,
  isPending,
  onConfirm,
  onCancel,
}: PostInstallConsentDialogProps) {
  return (
    <Dialog open={true} onClose={onCancel} title="Run plugin install scripts?" maxWidth="max-w-lg">
      <div className="space-y-4 border-l-4 border-rim-danger pl-4">
        <div
          className="flex items-start gap-2 rounded border border-rim-danger/40 bg-rim-danger/10 px-3 py-2"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rim-danger" />
          <p className="text-xs text-rim-text">
            <strong>
              This executes code from the plugin author with your user&apos;s privileges.
            </strong>{" "}
            Package managers run scripts shipped by the plugin and its dependencies. They are not
            limited by the plugin permissions you approve later.
          </p>
        </div>

        <p className="text-xs text-rim-text-muted">
          Installing <span className="font-mono text-rim-text">{request.plugin_id}</span> will run:
        </p>

        <ul className="space-y-2" aria-label="Commands that will run">
          {request.steps.map((step) => (
            <li
              key={`${step.trigger_file}:${step.command_line}`}
              className="rounded-lg border border-rim-line bg-rim-void px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <Terminal className="h-3.5 w-3.5 shrink-0 text-rim-text-muted" />
                <code className="font-mono text-xs text-rim-text">{step.command_line}</code>
              </div>
              <p className="mt-1 break-all text-[11px] text-rim-text-muted">
                in <span className="font-mono">{step.working_dir}</span>
              </p>
              <p className="text-[11px] text-rim-text-faint">
                because the repository contains {step.trigger_file}
              </p>
            </li>
          ))}
        </ul>

        <p className="text-[11px] text-rim-text-faint">
          Only continue if you trust the plugin author. If you cancel, nothing is installed.
        </p>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" isLoading={isPending} onClick={onConfirm}>
            Run commands and install
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
