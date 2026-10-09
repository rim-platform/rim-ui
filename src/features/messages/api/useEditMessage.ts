import { useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import type { MessageItem } from "../../../core/types/messages";
import { refusePlaintextIfPinned } from "../../e2ee/runtime/pins";
import { editEncrypted } from "../../e2ee/runtime/send";
import { toPrincipalMentions } from "../../e2ee/utils/content";
import type { ServerMember } from "../../workspaces/api/useServerMembers";
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
}

export function useEditMessageMutation() {
  const qc = useQueryClient();

  /** The cached message, when it is an encrypted one this device can read. */
  function encryptedMessage(vars: EditMessageVars): MessageItem | undefined {
    const data = qc.getQueryData<InfiniteData<MessagesPage>>(
      queryKeys.messages(vars.serverId, vars.conversationId),
    );
    const item = data?.pages.flatMap((p) => p.items).find((m) => m.id === vars.messageId);
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
      await refusePlaintextIfPinned(vars.serverId, vars.conversationId);
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

      // Optimistic update
      qc.setQueryData<InfiniteData<MessagesPage>>(messagesKey, (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            items: page.items.map((m) => (m.id === vars.messageId ? { ...m, text: vars.text } : m)),
          })),
        };
      });

      return { previousData };
    },
    onError: (_err, vars, context) => {
      // Revert optimistic update on failure
      if (context?.previousData) {
        const messagesKey = queryKeys.messages(vars.serverId, vars.conversationId);
        qc.setQueryData(messagesKey, context.previousData);
      }
    },
    onSettled: (_data, _err, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.messages(vars.serverId, vars.conversationId) });
    },
  });
}
