import { useState } from "react";

import { Dialog } from "../../../shared/ui/Dialog";
import { Button } from "../../../shared/ui/Button";
import { useCreateServerMutation } from "../api/useCreateServer";
import { useWorkspaceStore } from "../state/useWorkspaceStore";

export function CreateWorkspaceDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const setWorkspaceId = useWorkspaceStore((s) => s.setWorkspaceId);
  const create = useCreateServerMutation();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    create.mutate(
      { name: name.trim() },
      {
        onSuccess: (data) => {
          setWorkspaceId(data.createServer.id);
          onClose();
        },
      },
    );
  }

  return (
    <Dialog open title="New workspace" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-rim-text-faint">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            placeholder="My Workspace"
            autoFocus
            className="w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-rim-text-faint focus:border-rim-accent/40"
          />
        </label>

        {create.error && (
          <p className="rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-sm text-red-200">
            {create.error instanceof Error ? create.error.message : "Failed to create workspace"}
          </p>
        )}

        <Button
          type="submit"
          variant="primary"
          disabled={!name.trim()}
          isLoading={create.isPending}
          className="w-full"
        >
          {create.isPending ? "Creating..." : "Create"}
        </Button>
      </form>
    </Dialog>
  );
}
