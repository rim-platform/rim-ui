import { Button } from "../../../../shared/ui/Button";
import { Dialog } from "../../../../shared/ui/Dialog";
import type { RemovalPrompt } from "../state";

interface RemovedPluginDialogProps {
  prompt: RemovalPrompt;
  isPending: boolean;
  onRemove: () => void;
  onKeep: () => void;
}

/** A plugin stopped because its workspace removed it: remove it, or keep it as a local copy. */
export function RemovedPluginDialog({
  prompt,
  isPending,
  onRemove,
  onKeep,
}: RemovedPluginDialogProps) {
  const name = prompt.plugin.display_name;
  return (
    <Dialog open onClose={onKeep} title={`${name} was removed`} maxWidth="max-w-md">
      <div className="space-y-3 text-xs text-rim-text-muted">
        <p className="text-sm text-rim-text">
          {prompt.workspaceName} removed {name} from its plugins. Remove it from this device?
        </p>
        <p>
          It has been stopped. Remove deletes it and its data. Keep leaves it installed, turned off,
          as a local plugin that no longer gets updates.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" disabled={isPending} onClick={onKeep}>
            Keep
          </Button>
          <Button variant="danger" size="sm" isLoading={isPending} onClick={onRemove}>
            Remove
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
