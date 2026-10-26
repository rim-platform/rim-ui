import { useState } from "react";

import { PostingPolicy } from "../../../core/graphql/generated/schema-types";
import { toast } from "../../../shared/toast";
import { cn } from "../../../shared/ui/cn";
import { ModerationDialog } from "../../workspaces/components/ModerationDialog";
import { useChannelPosting, useSetChannelPostingMutation } from "../api/useChannelPosting";
import type { ConversationSummary } from "../types";
import { conversationLabel } from "../utils";

interface ChannelPostingDialogProps {
  workspaceId: string;
  conversation: ConversationSummary;
  onClose: () => void;
}

interface PostingChoice {
  policy: PostingPolicy;
  allowsThreads: boolean;
}

/** Picks who may post in a channel (Owner/Moderator; the server re-checks). */
export function ChannelPostingDialog({
  workspaceId,
  conversation,
  onClose,
}: ChannelPostingDialogProps) {
  const posting = useChannelPosting(workspaceId, conversation);
  const setPosting = useSetChannelPostingMutation();
  // Null until the moderator changes something: the form shows the channel's current setting.
  const [choice, setChoice] = useState<PostingChoice | null>(null);
  const label = conversationLabel(conversation);
  const current: PostingChoice = { policy: posting.policy, allowsThreads: posting.allowsThreads };
  const chosen = choice ?? current;
  const restricted = chosen.policy === PostingPolicy.MODERATORS;
  const unchanged =
    chosen.policy === current.policy &&
    (!restricted || chosen.allowsThreads === current.allowsThreads);

  return (
    <ModerationDialog
      title={`Who can post in ${label}`}
      description="Owners and moderators can always post. The setting applies to everyone else in the channel."
      tone="accent"
      chips={["MUTATING"]}
      confirmLabel="Save"
      confirmDisabled={!posting.supported || unchanged}
      errorFallback="Could not change who can post"
      onConfirm={() =>
        setPosting.mutateAsync({
          serverId: workspaceId,
          conversationId: conversation.id,
          policy: chosen.policy,
          allowsThreads: chosen.allowsThreads,
        })
      }
      onDone={() => {
        toast.success(
          restricted
            ? `Only the owner and moderators can post in ${label}`
            : `Everyone can post in ${label}`,
        );
        onClose();
      }}
      onClose={onClose}
    >
      {!posting.supported ? (
        <p className="text-sm text-rim-text-muted">
          {posting.isLoading
            ? "Loading…"
            : "This workspace's server does not offer posting permissions."}
        </p>
      ) : (
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-xs font-medium text-rim-text">Who can post</legend>
          <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-rim-text hover:bg-white/5">
            <input
              type="radio"
              name="channel-posting"
              value={PostingPolicy.EVERYONE}
              checked={!restricted}
              onChange={() => setChoice({ ...chosen, policy: PostingPolicy.EVERYONE })}
              className="accent-rim-accent"
            />
            Everyone
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-rim-text hover:bg-white/5">
            <input
              type="radio"
              name="channel-posting"
              value={PostingPolicy.MODERATORS}
              checked={restricted}
              onChange={() => setChoice({ ...chosen, policy: PostingPolicy.MODERATORS })}
              className="accent-rim-accent"
            />
            Owner and moderators
          </label>
          <label
            className={cn(
              "ml-6 flex items-center gap-2 rounded px-2 py-1 text-sm",
              restricted ? "cursor-pointer text-rim-text hover:bg-white/5" : "text-rim-text-faint",
            )}
          >
            <input
              type="checkbox"
              checked={chosen.allowsThreads}
              disabled={!restricted}
              onChange={(e) => setChoice({ ...chosen, allowsThreads: e.target.checked })}
              className="accent-rim-accent"
            />
            Others can still react and reply in threads
          </label>
        </fieldset>
      )}
    </ModerationDialog>
  );
}
