import { useCallback } from "react";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";

import { useExecuteCommandMutation } from "../../commands/api/useCommands";
import { queryKeys } from "../../../core/query/keys";
import { toast } from "../../../shared/toast";
import { graphqlErrorMessage } from "../../../core/graphql/errors";
import type { MessagesPage } from "../api/useMessages";

export function useDeleteMessage(
  workspaceId: string | null | undefined,
  conversationId: string | null | undefined,
) {
  const executeCommandMutation = useExecuteCommandMutation();
  const qc = useQueryClient();

  /**
   * Deletes a message (the author's own, or anyone's for Owner/Moderator) with an optimistic
   * update. A failure reverts it and toasts, or rethrows with `throwOnError` so a confirmation
   * dialog can show the server's message instead.
   */
  const deleteMessage = useCallback(
    async (messageId: string, options: { throwOnError?: boolean } = {}) => {
      if (!workspaceId || !conversationId) return;

      const messagesKey = queryKeys.messages(workspaceId, conversationId);
      const previousData = qc.getQueryData<InfiniteData<MessagesPage>>(messagesKey);

      // Optimistic update: mark message as deleted in cache immediately
      qc.setQueryData<InfiniteData<MessagesPage>>(messagesKey, (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            items: page.items.map((m) =>
              m.id === messageId ? { ...m, isDeleted: true, text: "" } : m,
            ),
          })),
        };
      });

      try {
        const res = await executeCommandMutation.mutateAsync({
          commandId: "chat.delete_message",
          commandContext: {
            workspaceId,
            conversationId,
            selectedMessageId: messageId,
          },
        });
        if (res.executeCommand.status === "ERROR") {
          throw new Error(res.executeCommand.message || "Failed to delete message");
        }
      } catch (err) {
        // Revert optimistic update on failure
        if (previousData) {
          qc.setQueryData(messagesKey, previousData);
        }
        if (options.throwOnError) throw err;
        toast.error(graphqlErrorMessage(err, "Failed to delete message"));
      }
    },
    [workspaceId, conversationId, executeCommandMutation, qc],
  );

  return deleteMessage;
}
