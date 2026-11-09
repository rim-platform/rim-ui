import { useCallback } from "react";
import type { InfiniteData, QueryClient } from "@tanstack/react-query";

import { CommandSensitivity } from "../../../core/graphql/generated/schema-types";
import { runCommandFromClick, type ClickSource } from "../../commands/runtime/runFromClick";
import { queryKeys } from "../../../core/query/keys";
import type { MessagesPage } from "../api/useMessages";

const DELETE_MESSAGE = "chat.delete_message";

const MODERATOR_DELETE_DESCRIPTION =
  "You are deleting another member's message as a moderator. This cannot be undone, and it is recorded in the audit log.";

/** Shows a message the server deleted as deleted in its conversation's cached timeline. */
export function markMessageDeleted(
  qc: QueryClient,
  workspaceId: string,
  conversationId: string,
  messageId: string,
): void {
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
}

/** How {@link useDeleteMessage}'s function deletes a message. */
export interface DeleteMessageOptions {
  /** Deletes another member's message as an Owner or Moderator, who must type the verb. */
  asModerator?: boolean;
  /** The kind of control that asked; a menu item when left out. */
  source?: ClickSource;
  /** The thread the message is in, when it is a reply in one. */
  threadId?: string;
}

/**
 * A function that deletes a message of `conversationId` with `chat.delete_message`, as the
 * palette runs it on that message: the author's own, or with `asModerator` anyone's for an
 * Owner or Moderator. The server holds the delete until the person confirms it in the
 * confirmation dialog, which says what deleting does; a moderator must also type the verb, the
 * author need not. The message shows as deleted once the server reports success, and a
 * moderator is told so. The function resolves `true` when the message was deleted; a failure is
 * shown as the command's refusal.
 */
export function useDeleteMessage(
  workspaceId: string | null | undefined,
  conversationId: string | null | undefined,
) {
  return useCallback(
    async (messageId: string, options: DeleteMessageOptions = {}): Promise<boolean> => {
      if (!workspaceId || !conversationId) return false;
      const outcome = await runCommandFromClick(DELETE_MESSAGE, undefined, {
        source: options.source ?? "menu",
        target: {
          workspaceId,
          conversationId,
          selectedMessageId: messageId,
          ...(options.threadId && { threadId: options.threadId }),
        },
        confirmation: {
          title: "Delete Message",
          description: options.asModerator
            ? MODERATOR_DELETE_DESCRIPTION
            : "Delete this message. This cannot be undone.",
          sensitivity: CommandSensitivity.RESTRICTED,
          // Deleting someone else's message needs the verb typed; one's own does not.
          ...(options.asModerator ? {} : { verb: null }),
        },
        successToast: options.asModerator ? "Message deleted" : null,
      });
      return outcome.ok;
    },
    [workspaceId, conversationId],
  );
}
