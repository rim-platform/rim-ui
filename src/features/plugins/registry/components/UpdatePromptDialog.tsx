import { AlertTriangle } from "lucide-react";

import { Button } from "../../../../shared/ui/Button";
import { Dialog } from "../../../../shared/ui/Dialog";
import { KIND_CONSENT_TEXT, listedSites } from "../../components/consentText";
import type { UpdatePrompt } from "../state";

interface UpdatePromptDialogProps {
  prompt: UpdatePrompt;
  /** Open the entry's install dialog, which verifies and installs it again. */
  onReview: () => void;
  onLater: () => void;
}

/** An update that needs the person: what is new, with a warning when the publisher changed. */
export function UpdatePromptDialog({ prompt, onReview, onLater }: UpdatePromptDialogProps) {
  const { plugin, check, plan, workspaceName } = prompt;
  return (
    <Dialog open onClose={onLater} title={`Update ${plugin.display_name}?`} maxWidth="max-w-md">
      <div className="space-y-3 text-xs text-rim-text-muted">
        <p>
          {workspaceName} updated {plugin.display_name} from {plugin.version} to{" "}
          {check.statement.version}. This update needs your approval.
        </p>
        <ul className="space-y-1 text-rim-text">
          {plan.publisherChanged && (
            <li className="flex items-center gap-1.5 text-rim-warm" role="alert">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              Signed by another publisher: “{check.statement.publisherName}”
            </li>
          )}
          {plan.kindChanged && <li>{KIND_CONSENT_TEXT[check.manifest.runtime_kind]}</li>}
          {plan.newCapabilities.length > 0 && (
            <li>New permissions: {plan.newCapabilities.join(", ")}</li>
          )}
          {plan.newAiCommands.length > 0 && (
            <li>New commands the AI agent can run: {plan.newAiCommands.join(", ")}</li>
          )}
          {plan.sitesChanged && (
            <li>
              Connects to other sites:{" "}
              {listedSites(check.manifest.network_origins ?? []).join(", ")}
            </li>
          )}
          {!plan.publisherChanged &&
            !plan.kindChanged &&
            plan.newCapabilities.length === 0 &&
            plan.newAiCommands.length === 0 &&
            !plan.sitesChanged && <li>It runs steps after installing.</li>}
        </ul>
        <p>Until you update, the installed version keeps running.</p>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" onClick={onLater}>
            Later
          </Button>
          <Button size="sm" onClick={onReview}>
            Review update
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
