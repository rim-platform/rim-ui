import { useState } from "react";

import { Button } from "../../../shared/ui/Button";
import { runCommandFromClick } from "../../commands/runtime/runFromClick";
import type { ConversationSummary } from "../types";
import { ChannelIcon } from "./ChannelIcon";

interface JoinChannelBarProps {
  workspaceId: string;
  conversation: ConversationSummary;
}

/** Replaces the composer while the viewer reads a public channel they have not joined. */
export function JoinChannelBar({ workspaceId, conversation }: JoinChannelBarProps) {
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = conversation.memberCount;

  async function join() {
    setJoining(true);
    setError(null);
    try {
      await runCommandFromClick(
        "chat.join_channel",
        { server_id: workspaceId, conversation_id: conversation.id },
        {
          target: { workspaceId, conversationId: conversation.id },
          throwOnError: true,
          successToast: () => null,
        },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not join the channel");
    } finally {
      setJoining(false);
    }
  }

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
          isLoading={joining}
          onClick={() => void join()}
        >
          Join channel
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-rim-danger">
          {error}
        </p>
      )}
    </div>
  );
}
