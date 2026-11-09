import { useCallback } from "react";

import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { toast } from "../../../shared/toast";
import { closeLeftConversation, useLeaveConversationMutation } from "../api/useChannelMembership";
import type { ConversationSummary } from "../types";
import { conversationLabel } from "../utils";

/**
 * Leaves a channel or group and, when it is the open conversation, returns to the workspace
 * home (the conversation list selects the first conversation). A conversation that names its
 * `serverId` is left in that workspace, any other in `workspaceId`. Errors surface the server's
 * message.
 */
export function useLeaveConversation(workspaceId: string | null | undefined) {
  const mutation = useLeaveConversationMutation();
  const { mutate } = mutation;

  const leave = useCallback(
    (
      conversation: Pick<ConversationSummary, "id" | "conversationType" | "title"> &
        Partial<Pick<ConversationSummary, "serverId">>,
    ) => {
      const serverId = conversation.serverId ?? workspaceId;
      if (!serverId) return;
      mutate(
        { serverId, conversationId: conversation.id },
        {
          onSuccess: () => {
            closeLeftConversation(conversation.id);
            toast.success(`Left ${conversationLabel(conversation)}`);
          },
          onError: (err) => {
            toast.error(graphqlErrorMessage(err, "Could not leave the conversation"));
          },
        },
      );
    },
    [workspaceId, mutate],
  );

  return { leave, isPending: mutation.isPending };
}
