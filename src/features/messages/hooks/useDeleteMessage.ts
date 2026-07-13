import { useCallback } from "react";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";

import { useExecuteCommandMutation } from "../../commands/api/useCommands";
import { queryKeys } from "../../../core/query/keys";
import { toast } from "../../../shared/toast";
import type { MessagesPage } from "../api/useMessages";

export function useDeleteMessage(
  workspaceId: string | null | undefined,
  conversationId: string | null | undefined,
) {
  const executeCommandMutation = useExecuteCommandMutation();
  const qc = useQueryClient();

  const deleteMessage = useCallback(
    async (messageId: string) => {
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
        await executeCommandMutation.mutateAsync({
          commandId: "chat.delete_message",
          commandContext: {
            workspaceId,
            conversationId,
            selectedMessageId: messageId,
          },
          confirmedDangerous: true,
        });
      } catch {
        // Revert optimistic update on failure
        if (previousData) {
          qc.setQueryData(messagesKey, previousData);
        }
        toast.error("Failed to delete message");
      }
    },
    [workspaceId, conversationId, executeCommandMutation, qc],
  );

  return deleteMessage;
}
