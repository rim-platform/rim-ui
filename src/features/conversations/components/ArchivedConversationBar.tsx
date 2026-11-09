import { useState } from "react";
import { Archive } from "lucide-react";

import { Button } from "../../../shared/ui/Button";
import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";
import { runCommandFromClick } from "../../commands/runtime/runFromClick";
import { useCanModerate } from "../../workspaces/api/useMyServerRole";
import type { ConversationSummary } from "../types";

interface ArchivedConversationBarProps {
  workspaceId: string;
  conversation: ConversationSummary;
}

/** Replaces the composer for an archived channel; Owner/Moderator can unarchive from here. */
export function ArchivedConversationBar({
  workspaceId,
  conversation,
}: ArchivedConversationBarProps) {
  const canModerate = useCanModerate(workspaceId);
  const [unarchiving, setUnarchiving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isChannel = conversation.conversationType === ConversationTypeEnum.CHANNEL;

  async function unarchive() {
    setUnarchiving(true);
    setError(null);
    try {
      await runCommandFromClick(
        "chat.unarchive_channel",
        { server_id: workspaceId, conversation_id: conversation.id },
        {
          target: { workspaceId, conversationId: conversation.id },
          throwOnError: true,
          successToast: null,
        },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not unarchive the channel");
    } finally {
      setUnarchiving(false);
    }
  }

  return (
    <div
      data-testid="archived-conversation-bar"
      className="flex flex-col gap-2 border-t border-rim-line bg-rim-panel-soft px-4 py-3"
    >
      <div className="flex items-center gap-3">
        <Archive className="h-4 w-4 shrink-0 text-rim-text-muted" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-sm text-rim-text-muted">
          {isChannel ? "This channel is archived" : "This conversation is archived"}
          <span className="text-rim-text-faint"> &middot; read-only</span>
        </p>
        {isChannel && canModerate && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            isLoading={unarchiving}
            onClick={() => void unarchive()}
          >
            Unarchive
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-rim-danger">
          {error}
        </p>
      )}
    </div>
  );
}
