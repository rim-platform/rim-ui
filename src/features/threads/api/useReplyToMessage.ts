import { useMutation, useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";

const REPLY_TO_MESSAGE_MUTATION = gql`
  mutation ReplyToMessage($input: ReplyToMessageInput!) {
    replyToMessage(input: $input) {
      id
      serverId
      conversationId
      threadId
      rootThreadId
      authorId
      text
      hasAttachments
      parentMessageId
      isDeleted
      sentAt
      reactions {
        emoji
        count
        reactedByMe
        userIds
      }
    }
  }
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
    mutationFn: (vars: ReplyToMessageVars) =>
      graphqlClient.request<ReplyToMessageResponse>(REPLY_TO_MESSAGE_MUTATION, {
        input: {
          serverId: vars.serverId,
          conversationId: vars.conversationId,
          rootMessageId: vars.rootMessageId,
          text: vars.text,
        },
      }),
    onSuccess: (_data, vars) => {
      // Invalidate conversation messages (root message gets updated with rootThreadId)
      qc.invalidateQueries({ queryKey: queryKeys.messages(vars.serverId, vars.conversationId) });
      // Invalidate thread-related queries so new replies appear
      qc.invalidateQueries({
        queryKey: queryKeys.threadByRoot(vars.serverId, vars.conversationId, vars.rootMessageId),
      });
      // Invalidate all thread messages for this conversation (threadId may be new)
      qc.invalidateQueries({
        queryKey: ["threadMessages", vars.serverId, vars.conversationId],
      });
    },
  });
}
