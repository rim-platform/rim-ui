import { useState } from "react";

import { Dialog } from "../../../shared/ui/Dialog";
import { Button } from "../../../shared/ui/Button";
import { useCreateConversationMutation } from "../api/useCreateConversation";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useShellStore } from "../../../shell/state/useShellStore";

export function NewChannelDialog({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState("");
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const setConversation = useShellStore((s) => s.setSelectedConversationId);
  const create = useCreateConversationMutation();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId || !title.trim()) return;

    create.mutate(
      {
        serverId: workspaceId,
        title: title.trim(),
        isChannel: true,
      },
      {
        onSuccess: (data) => {
          setConversation(data.createConversation.id);
          onClose();
        },
      },
    );
  }

  return (
    <Dialog open title="New channel" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-rim-text-faint">
            Channel name
          </span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.currentTarget.value)}
            placeholder="general"
            autoFocus
            className="w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2.5 text-sm text-rim-text outline-none transition placeholder:text-rim-text-faint focus:border-rim-accent/40"
          />
        </label>

        {create.error && (
          <p className="rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger">
            {create.error instanceof Error ? create.error.message : "Failed to create channel"}
          </p>
        )}

        <Button
          type="submit"
          variant="primary"
          disabled={!title.trim()}
          isLoading={create.isPending}
          className="w-full"
        >
          {create.isPending ? "Creating..." : "Create"}
        </Button>
      </form>
    </Dialog>
  );
}
