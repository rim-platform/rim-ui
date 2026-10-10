import { useCallback } from "react";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";

import { CommandSensitivity } from "../../../core/graphql/generated/schema-types";
import { useExecuteCommandMutation } from "../../commands/api/useCommands";
import { runWithHumanConfirmation } from "../../commands/runtime/humanConfirmation";
import { queryKeys } from "../../../core/query/keys";
import { toast } from "../../../shared/toast";
import { graphqlErrorMessage } from "../../../core/graphql/errors";
import type { MessagesPage } from "../api/useMessages";

const DELETE_MESSAGE = "chat.delete_message";

export function useDeleteMessage(
  workspaceId: string | null | undefined,
  conversationId: string | null | undefined,
) {
  const executeCommandMutation = useExecuteCommandMutation();
  const qc = useQueryClient();

  /**
   * Deletes a message (the author's own, or anyone's for Owner/Moderator). The server holds
   * the delete until the user confirms it in the confirmation dialog, whose consequence line
   * is `description`. The message leaves the cache only once the server reports success.
   * Resolves `true` when the message was deleted; failures are toasted.
   */
  const deleteMessage = useCallback(
    async (messageId: string, options: { description?: string } = {}): Promise<boolean> => {
      if (!workspaceId || !conversationId) return false;

      const commandContext = { workspaceId, conversationId, selectedMessageId: messageId };
      try {
        const outcome = await runWithHumanConfirmation(
          async (confirmation) => {
            const res = await executeCommandMutation.mutateAsync({
              commandId: DELETE_MESSAGE,
              commandContext,
              confirmation,
            });
            return res.executeCommand;
          },
          {
            commandId: DELETE_MESSAGE,
            title: "Delete Message",
            description: options.description ?? "Delete this message. This cannot be undone.",
            // The server classes deleting a message as Restricted: the verb must be typed.
            sensitivity: CommandSensitivity.RESTRICTED,
          },
        );
        if (outcome.kind === "cancelled" || outcome.kind === "stale") return false;
        if (outcome.kind === "unconfirmed") {
          toast.error(outcome.message);
          return false;
        }
        if (outcome.result.status !== "SUCCESS") {
          toast.error(outcome.result.message || "Failed to delete message");
          return false;
        }
      } catch (err) {
        toast.error(graphqlErrorMessage(err, "Failed to delete message"));
        return false;
      }

      qc.setQueryData<InfiniteData<MessagesPage>>(
        queryKeys.messages(workspaceId, conversationId),
        (old) => {
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
        },
      );
      return true;
    },
    [workspaceId, conversationId, executeCommandMutation, qc],
  );

  return deleteMessage;
}
