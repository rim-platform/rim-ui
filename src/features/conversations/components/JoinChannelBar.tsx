import { Button } from "../../../shared/ui/Button";
import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { useJoinChannelMutation } from "../api/useChannelMembership";
import type { ConversationSummary } from "../types";
import { ChannelIcon } from "./ChannelIcon";

interface JoinChannelBarProps {
  workspaceId: string;
  conversation: ConversationSummary;
}

/** Replaces the composer while the viewer reads a public channel they have not joined. */
export function JoinChannelBar({ workspaceId, conversation }: JoinChannelBarProps) {
  const join = useJoinChannelMutation();
  const count = conversation.memberCount;

  return (
    <div
      data-testid="join-channel-bar"
      className="flex flex-col gap-2 border-t border-rim-line bg-rim-panel-soft px-4 py-3"
    >
      <div className="flex items-center gap-3">
        <ChannelIcon conversation={conversation} className="h-4 w-4 shrink-0 text-rim-text-muted" />
        <p className="min-w-0 flex-1 truncate text-sm text-rim-text-muted">
          You are viewing <span className="text-rim-text">#{conversation.title ?? "channel"}</span>
          <span className="text-rim-text-faint">
            {" "}
            &middot; {count} {count === 1 ? "member" : "members"}
          </span>
        </p>
        <Button
          type="button"
          variant="primary"
          size="sm"
          isLoading={join.isPending}
          onClick={() => join.mutate({ serverId: workspaceId, conversationId: conversation.id })}
        >
          Join channel
        </Button>
      </div>
      {join.error && (
        <p role="alert" className="text-xs text-rim-danger">
          {graphqlErrorMessage(join.error, "Could not join the channel")}
        </p>
      )}
    </div>
  );
}
