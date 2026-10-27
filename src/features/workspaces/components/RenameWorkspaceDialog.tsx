import { useId, useState } from "react";

import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { toast } from "../../../shared/toast";
import { Button } from "../../../shared/ui/Button";
import { Dialog } from "../../../shared/ui/Dialog";
import { useRenameWorkspaceMutation } from "../api/useWorkspaceMembership";

interface RenameWorkspaceDialogProps {
  workspaceId: string;
  name: string;
  onClose: () => void;
}

/** Asks for a workspace's new name, starting from the current one. */
export function RenameWorkspaceDialog({ workspaceId, name, onClose }: RenameWorkspaceDialogProps) {
  const [value, setValue] = useState(name);
  const rename = useRenameWorkspaceMutation();
  const hintId = useId();
  const trimmed = value.trim();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!trimmed || trimmed === name) return;
    rename.mutate(
      { serverId: workspaceId, name: trimmed },
      {
        onSuccess: () => {
          onClose();
          toast.success(`Renamed to ${trimmed}`);
        },
      },
    );
  }

  return (
    <Dialog open title="Rename workspace" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-rim-text-faint">
            Name
          </span>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.currentTarget.value)}
            autoFocus
            maxLength={128}
            aria-describedby={hintId}
            className="w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2.5 text-sm text-rim-text outline-none transition placeholder:text-rim-text-faint focus:border-rim-accent/40"
          />
        </label>
        <p id={hintId} className="-mt-2 text-xs text-rim-text-muted">
          Every member sees the new name.
        </p>

        {rename.error && (
          <p className="rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger">
            {graphqlErrorMessage(rename.error, "Could not rename the workspace")}
          </p>
        )}

        <Button
          type="submit"
          variant="primary"
          disabled={!trimmed || trimmed === name}
          isLoading={rename.isPending}
          className="w-full"
        >
          {rename.isPending ? "Renaming..." : "Rename"}
        </Button>
      </form>
    </Dialog>
  );
}
