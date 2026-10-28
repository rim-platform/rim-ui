import { useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import type { MessageItem } from "../../../core/types/messages";
import { refusePlaintextIfEncrypted } from "../../e2ee/runtime/pins";
import { editEncrypted } from "../../e2ee/runtime/send";
import { toPrincipalMentions } from "../../e2ee/utils/content";
import type { ServerMember } from "../../workspaces/api/useServerMembers";
import { hasCapability, MESSAGE_EDITED_AT } from "../../updater/api/serverCapabilities";
import type { KnownServerInfo } from "../../updater/api/serverInfoApi";
import type { ThreadMessagesPage } from "../../threads/api/useThreads";
import type { MessagesPage } from "./useMessages";

const EDIT_MESSAGE = gql`
  mutation EditMessage($input: EditMessageInput!) {
    editMessage(input: $input) {
      id
      text
      isDeleted
      sentAt
    }
  }
`;

interface EditMessageVars {
  serverId: string;
  conversationId: string;
  messageId: string;
  text: string;
  /** The thread the message is a reply in; that thread's cache is updated too. */
  threadId?: string | null;
}

export function useEditMessageMutation() {
  const qc = useQueryClient();

  /** The cached message, when it is an encrypted one this device can read. */
  function encryptedMessage(vars: EditMessageVars): MessageItem | undefined {
    const data = qc.getQueryData<InfiniteData<MessagesPage>>(
      queryKeys.messages(vars.serverId, vars.conversationId),
    );
    let item = data?.pages.flatMap((p) => p.items).find((m) => m.id === vars.messageId);
    if (!item && vars.threadId) {
      const thread = qc.getQueryData<ThreadMessagesPage>(
        queryKeys.threadMessages(vars.serverId, vars.conversationId, vars.threadId),
      );
      item = thread?.items.find((m) => m.id === vars.messageId) as MessageItem | undefined;
    }
    return item?.e2ee?.status === "decrypted" ? item : undefined;
  }

  return useMutation({
    mutationFn: async (vars: EditMessageVars) => {
      const encrypted = encryptedMessage(vars);
      if (encrypted) {
        // The edit form shows mentions as user tokens; the content names principals.
        const members = qc.getQueryData<ServerMember[]>(queryKeys.serverMembers(vars.serverId));
        const principalOf = (userId: string) =>
          members?.find((m) => m.userId === userId)?.principalId;
        const body = toPrincipalMentions(vars.text, new Map(), principalOf);
        const author = encrypted.author ?? {
          id: encrypted.authorId,
          username: "",
          displayName: null,
          avatarUrl: null,
        };
        await editEncrypted(vars.serverId, vars.conversationId, vars.messageId, body, author);
        return null;
      }
      await refusePlaintextIfEncrypted(qc, vars.serverId, vars.conversationId);
      return graphqlClient.request(EDIT_MESSAGE, {
        input: {
          serverId: vars.serverId,
          conversationId: vars.conversationId,
          messageId: vars.messageId,
          text: vars.text,
        },
      });
    },
    onMutate: async (vars) => {
      const messagesKey = queryKeys.messages(vars.serverId, vars.conversationId);
      await qc.cancelQueries({ queryKey: messagesKey });

      const previousData = qc.getQueryData<InfiniteData<MessagesPage>>(messagesKey);
      // Marked edited only where the refetch after it brings the server's edit time back.
      const marksEdits = hasCapability(
        qc.getQueryData<KnownServerInfo>(queryKeys.serverInfo),
        MESSAGE_EDITED_AT,
      );
      const edit = marksEdits
        ? { text: vars.text, editedAt: new Date().toISOString() }
        : { text: vars.text };

      // Optimistic update
      qc.setQueryData<InfiniteData<MessagesPage>>(messagesKey, (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            items: page.items.map((m) => (m.id === vars.messageId ? { ...m, ...edit } : m)),
          })),
        };
      });

      let previousThread: ThreadMessagesPage | undefined;
      if (vars.threadId) {
        const threadKey = queryKeys.threadMessages(
          vars.serverId,
          vars.conversationId,
          vars.threadId,
        );
        await qc.cancelQueries({ queryKey: threadKey });
        previousThread = qc.getQueryData<ThreadMessagesPage>(threadKey);
        qc.setQueryData<ThreadMessagesPage>(threadKey, (old) =>
          old
            ? {
                ...old,
                items: old.items.map((m) => (m.id === vars.messageId ? { ...m, ...edit } : m)),
              }
            : old,
        );
      }

      return { previousData, previousThread };
    },
    onError: (_err, vars, context) => {
      // Revert optimistic update on failure
      if (context?.previousData) {
        const messagesKey = queryKeys.messages(vars.serverId, vars.conversationId);
        qc.setQueryData(messagesKey, context.previousData);
      }
      if (vars.threadId && context?.previousThread) {
        qc.setQueryData(
          queryKeys.threadMessages(vars.serverId, vars.conversationId, vars.threadId),
          context.previousThread,
        );
      }
    },
    // A saved plaintext edit comes back as the server's MessageUpdated event, which updates and
    // refetches the timeline (and the thread); a failed or encrypted one is refetched here.
    onSettled: (data, err, vars) => {
      if (!err && data !== null) return;
      qc.invalidateQueries({ queryKey: queryKeys.messages(vars.serverId, vars.conversationId) });
      if (vars.threadId) {
        qc.invalidateQueries({
          queryKey: queryKeys.threadMessages(vars.serverId, vars.conversationId, vars.threadId),
        });
      }
    },
  });
}
