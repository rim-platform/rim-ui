import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import {
  ConversationTypeEnum,
  PostingPolicy,
  type MutationSetChannelPostingArgs,
} from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { useCanModerate } from "../../workspaces/api/useMyServerRole";
import type { ConversationSummary } from "../types";
import { postingAllows, type PostKind } from "../utils";
import { useConversation } from "./useConversation";
import { invalidateConversationQueries } from "./useChannelMembership";

const CHANNEL_POSTING = gql`
  query ChannelPosting($serverId: ID!, $conversationId: ID!) {
    conversation(serverId: $serverId, conversationId: $conversationId) {
      id
      postingPolicy
      postingAllowsThreads
    }
  }
`;

const SET_CHANNEL_POSTING = gql`
  mutation SetChannelPosting(
    $serverId: ID!
    $conversationId: ID!
    $policy: PostingPolicy!
    $allowsThreads: Boolean!
  ) {
    setChannelPosting(
      serverId: $serverId
      conversationId: $conversationId
      policy: $policy
      allowsThreads: $allowsThreads
    ) {
      id
      postingPolicy
      postingAllowsThreads
    }
  }
`;

/** A channel's posting fields as the server answers them. */
interface PostingFields {
  id: string;
  postingPolicy: PostingPolicy;
  postingAllowsThreads: boolean;
}

/** Who may post in a channel. */
export interface ChannelPosting {
  policy: PostingPolicy;
  /** Under `MODERATORS`, whether everyone else may still react and reply in threads. */
  allowsThreads: boolean;
  /**
   * Whether the server reported the channel's posting. False while it is asked, for a DM or a
   * group, and when the server refuses the query (an older server, which restricts nobody).
   */
  supported: boolean;
}

const EVERYONE_POSTS: ChannelPosting = {
  policy: PostingPolicy.EVERYONE,
  allowsThreads: true,
  supported: false,
};

/** The cache key of a channel's posting, under its conversation so its invalidation covers it. */
export function channelPostingKey(workspaceId?: string, conversationId?: string) {
  return [...queryKeys.conversation(workspaceId, conversationId), "posting"] as const;
}

function fromFields(fields: PostingFields): ChannelPosting {
  return {
    policy: fields.postingPolicy,
    allowsThreads: fields.postingAllowsThreads,
    supported: true,
  };
}

/**
 * A channel's posting policy, asked apart from the conversation itself so an older server's
 * refusal of the fields leaves every other conversation query working.
 *
 * @param conversation The conversation as the client holds it; only a channel the viewer can
 *   read (a member, or a public channel) is asked about.
 * @returns The policy, or everyone-posts with `supported: false` while unknown or refused.
 */
export function useChannelPosting(
  workspaceId: string | null | undefined,
  conversation: ConversationSummary | null | undefined,
): ChannelPosting & { isLoading: boolean } {
  const ws = workspaceId ?? undefined;
  const id = conversation?.id;
  const enabled = Boolean(
    ws &&
    conversation &&
    conversation.conversationType === ConversationTypeEnum.CHANNEL &&
    (conversation.isMember || !conversation.isPrivate),
  );
  const query = useQuery({
    queryKey: channelPostingKey(ws, id),
    enabled,
    retry: false,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await graphqlClient.request<{ conversation: PostingFields }>(CHANNEL_POSTING, {
        serverId: ws,
        conversationId: id,
      });
      return res.conversation;
    },
  });
  if (query.data) return { ...fromFields(query.data), isLoading: false };
  return { ...EVERYONE_POSTS, isLoading: enabled && query.isPending };
}

/**
 * A channel's posting as the cache holds it, for menus built outside render.
 *
 * @returns The channel's posting once answered; everyone-posts with `supported: false` once a
 *   posting query of the workspace failed (its server has no posting policy); `undefined`
 *   while neither is known.
 */
export function cachedChannelPosting(
  qc: QueryClient,
  workspaceId: string,
  conversationId: string,
): ChannelPosting | undefined {
  const fields = qc.getQueryData<PostingFields>(channelPostingKey(workspaceId, conversationId));
  if (fields) return fromFields(fields);
  // Every conversation query of the workspace, of which the posting ones end in "posting".
  const [root, , , leaf] = channelPostingKey(workspaceId);
  const refused = qc
    .getQueryCache()
    .findAll({ queryKey: [root, workspaceId] })
    .some((q) => q.queryKey[3] === leaf && q.state.status === "error");
  return refused ? EVERYONE_POSTS : undefined;
}

/**
 * What the viewer may add to a conversation under its channel's posting policy; everything in
 * a DM, a group, or on a server without posting policies.
 */
export function usePostingRights(
  workspaceId: string | null | undefined,
  conversationId: string | null | undefined,
): Record<PostKind, boolean> {
  const { data: conversation } = useConversation(workspaceId, conversationId);
  const posting = useChannelPosting(workspaceId, conversation);
  const canModerate = useCanModerate(workspaceId ?? undefined);
  return {
    message: postingAllows(posting, canModerate, "message"),
    thread: postingAllows(posting, canModerate, "thread"),
    reaction: postingAllows(posting, canModerate, "reaction"),
    pin: postingAllows(posting, canModerate, "pin"),
  };
}

/** Set who may post in a channel (Owner/Moderator; channels only; not when archived). */
export function useSetChannelPostingMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: MutationSetChannelPostingArgs) => {
      const res = await graphqlClient.request<{ setChannelPosting: PostingFields }>(
        SET_CHANNEL_POSTING,
        vars,
      );
      return res.setChannelPosting;
    },
    onSuccess: (posting, vars) => {
      qc.setQueryData(channelPostingKey(vars.serverId, vars.conversationId), posting);
      invalidateConversationQueries(qc, vars.serverId, vars.conversationId);
    },
  });
}
