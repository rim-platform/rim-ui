import { useState } from "react";
import { Lock } from "lucide-react";

import { Dialog } from "../../../shared/ui/Dialog";
import { Button } from "../../../shared/ui/Button";
import { cn } from "../../../shared/ui/cn";
import { toast } from "../../../shared/toast";
import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { useCreateConversationMutation } from "../api/useCreateConversation";
import { useAddConversationMembersMutation } from "../api/useChannelMembership";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { MemberPicker } from "./MemberPicker";

const PRIVATE_CHANNEL_HINT =
  "Only invited members can see this channel. This cannot be changed later.";

export function NewChannelDialog({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const setConversation = useShellStore((s) => s.setSelectedConversationId);
  const create = useCreateConversationMutation();
  const addMembers = useAddConversationMembersMutation();
  const isSubmitting = create.isPending || addMembers.isPending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId || !title.trim() || isSubmitting) return;

    let conversationId: string;
    try {
      const created = await create.mutateAsync({
        serverId: workspaceId,
        title: title.trim(),
        isChannel: true,
        isPrivate,
      });
      conversationId = created.createConversation.id;
    } catch {
      // Shown inline from `create.error`.
      return;
    }

    // The creator is added by the server; initial members are invited right after.
    if (memberIds.length > 0) {
      try {
        await addMembers.mutateAsync({
          serverId: workspaceId,
          conversationId,
          userIds: memberIds,
        });
      } catch (err) {
        toast.error("Channel created, but inviting members failed", {
          description: graphqlErrorMessage(err, "Invite them from the members panel."),
        });
      }
    }

    setConversation(conversationId);
    onClose();
  }

  return (
    <Dialog open title="New channel" onClose={onClose} maxWidth="max-w-md">
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
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

        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            role="switch"
            checked={isPrivate}
            onChange={(e) => setIsPrivate(e.currentTarget.checked)}
            aria-describedby="new-channel-private-hint"
            className="peer sr-only"
          />
          <span
            aria-hidden="true"
            className={cn(
              "mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full border border-rim-line p-0.5 transition peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-rim-accent",
              isPrivate ? "bg-rim-accent/80" : "bg-rim-void",
            )}
          >
            <span
              className={cn(
                "h-3.5 w-3.5 rounded-full bg-rim-text transition",
                isPrivate && "translate-x-4",
              )}
            />
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-sm text-rim-text">
              <Lock className="h-3.5 w-3.5" />
              Private
            </span>
            <span id="new-channel-private-hint" className="block text-xs text-rim-text-muted">
              {PRIVATE_CHANNEL_HINT}
            </span>
          </span>
        </label>

        <div>
          <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-rim-text-faint">
            Add members (optional)
          </span>
          <div className="rounded-lg border border-rim-line bg-rim-void">
            <MemberPicker
              workspaceId={workspaceId ?? undefined}
              selectedUserIds={memberIds}
              onChange={setMemberIds}
              placeholder="Search people to add..."
              listClassName="max-h-40"
            />
          </div>
        </div>

        {create.error && (
          <p className="rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger">
            {graphqlErrorMessage(create.error, "Failed to create channel")}
          </p>
        )}

        <Button
          type="submit"
          variant="primary"
          disabled={!title.trim()}
          isLoading={isSubmitting}
          className="w-full"
        >
          {isSubmitting ? "Creating..." : "Create"}
        </Button>
      </form>
    </Dialog>
  );
}
