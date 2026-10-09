import { Button } from "../../../../shared/ui/Button";
import { Dialog } from "../../../../shared/ui/Dialog";
import type { RegistryItem } from "../hooks";
import { TrustBadge } from "./TrustBadge";

interface RequiredPluginsDialogProps {
  workspaceName: string;
  /** Required entries this device can install and has not, or has at another statement. */
  installable: RegistryItem[];
  /** Required entries that need the desktop app, listed once on the web. */
  needDesktop: RegistryItem[];
  onReview: (item: RegistryItem) => void;
  onNotNow: () => void;
}

/**
 * The plugins a workspace requires, offered when it opens. Nothing installs from here: each
 * goes through its install dialog and permission prompt.
 */
export function RequiredPluginsDialog({
  workspaceName,
  installable,
  needDesktop,
  onReview,
  onNotNow,
}: RequiredPluginsDialogProps) {
  return (
    <Dialog open onClose={onNotNow} title={`${workspaceName} requires plugins`} maxWidth="max-w-md">
      <div className="space-y-3 text-xs text-rim-text-muted">
        <p>
          {workspaceName} asks every member to install these. Nothing is installed until you review
          it.
        </p>
        <ul className="space-y-2">
          {installable.map((item) => (
            <li
              key={item.check.entry.pluginId}
              className="flex items-center gap-3 rounded-md border border-rim-line p-2"
            >
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="text-sm text-rim-text">{item.check.entry.displayName}</p>
                <TrustBadge publisher={item.publisher} />
              </div>
              <Button size="sm" onClick={() => onReview(item)}>
                Review and install
              </Button>
            </li>
          ))}
          {needDesktop.map((item) => (
            <li
              key={item.check.entry.pluginId}
              className="flex items-center gap-3 rounded-md border border-rim-line p-2"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm text-rim-text">{item.check.entry.displayName}</p>
                <p className="text-rim-warm">Needs the desktop app</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex justify-end pt-1">
          <Button variant="secondary" size="sm" onClick={onNotNow}>
            Not now
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
