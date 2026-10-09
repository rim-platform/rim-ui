import { useMutation, useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import { logger } from "../../../core/logger";
import { MESSAGE_WITH_REACTIONS } from "../../../graphql/fragments/message";
import { refusePlaintextIfPinned } from "../../e2ee/runtime/pins";

export const REPLY_TO_MESSAGE_MUTATION = gql`
  mutation ReplyToMessage($input: ReplyToMessageInput!) {
    replyToMessage(input: $input) {
      ...MessageWithReactions
    }
  }
  ${MESSAGE_WITH_REACTIONS}
`;

interface ReplyToMessageResponse {
  replyToMessage: {
    id: string;
    serverId: string;
    conversationId: string;
    threadId: string | null;
    rootThreadId: string | null;
    authorId: string;
    text: string;
    hasAttachments: boolean;
    parentMessageId: string | null;
    isDeleted: boolean;
    sentAt: string;
    reactions: {
      emoji: string;
      count: number;
      reactedByMe: boolean;
      userIds: string[];
    }[];
  };
}

interface ReplyToMessageVars {
  serverId: string;
  conversationId: string;
  rootMessageId: string;
  text: string;
}

export function useReplyToMessageMutation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (vars: ReplyToMessageVars) => {
      await refusePlaintextIfPinned(vars.serverId, vars.conversationId);
      return graphqlClient.request<ReplyToMessageResponse>(REPLY_TO_MESSAGE_MUTATION, {
        input: {
          serverId: vars.serverId,
          conversationId: vars.conversationId,
          rootMessageId: vars.rootMessageId,
          text: vars.text,
        },
      });
    },
    onError: (error, vars) => {
      logger.error("[RIM:Thread] Reply mutation failed:", error, "vars:", vars);
    },
    onSuccess: async (data, vars) => {
      logger.debug(
        "[RIM:Thread] Reply success:",
        data.replyToMessage.id,
        "threadId:",
        data.replyToMessage.threadId,
      );
      const threadId = data.replyToMessage.threadId ?? undefined;

      // Invalidate conversation messages (root message gets updated with rootThreadId)
      qc.invalidateQueries({ queryKey: queryKeys.messages(vars.serverId, vars.conversationId) });

      // Refetch threadByRoot so ThreadPanel picks up the newly created thread.
      // We await this because useThreadMessages depends on threadId from this query —
      // if we only invalidate, the threadMessages query may not exist yet (it's disabled
      // when threadId is undefined) and the invalidation below would be a no-op.
      await qc.refetchQueries({
        queryKey: queryKeys.threadByRoot(vars.serverId, vars.conversationId, vars.rootMessageId),
      });

      // Now threadId is available in the component, useThreadMessages is enabled.
      // Invalidate thread messages so the new reply appears.
      if (threadId) {
        qc.invalidateQueries({
          queryKey: queryKeys.threadMessages(vars.serverId, vars.conversationId, threadId),
        });
      }
    },
  });
}
