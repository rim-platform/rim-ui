import { Archive } from "lucide-react";

import { Button } from "../../../shared/ui/Button";
import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";
import { useCanModerate } from "../../workspaces/api/useMyServerRole";
import { useSetConversationArchivedMutation } from "../api/useChannelMembership";
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
  const setArchived = useSetConversationArchivedMutation();
  const isChannel = conversation.conversationType === ConversationTypeEnum.CHANNEL;

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
            isLoading={setArchived.isPending}
            onClick={() =>
              setArchived.mutate({
                serverId: workspaceId,
                conversationId: conversation.id,
                archived: false,
              })
            }
          >
            Unarchive
          </Button>
        )}
      </div>
      {setArchived.error && (
        <p role="alert" className="text-xs text-rim-danger">
          {graphqlErrorMessage(setArchived.error, "Could not unarchive the channel")}
        </p>
      )}
    </div>
  );
}
