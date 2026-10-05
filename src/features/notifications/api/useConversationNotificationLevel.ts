import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import { NotificationLevel } from "../../../core/graphql/generated/schema-types";
import { useMutedStore } from "../../conversations/state/useMutedStore";
import type { ConversationSummary, ConversationSummaryPage } from "../../conversations/types";

const SET_CONVERSATION_NOTIFICATION_LEVEL = gql`
  mutation SetConversationNotificationLevel(
    $serverId: ID!
    $conversationId: ID!
    $level: NotificationLevel
  ) {
    setConversationNotificationLevel(
      serverId: $serverId
      conversationId: $conversationId
      level: $level
    ) {
      conversationId
      level
      effectiveLevel
      mutedUntil
    }
  }
`;

export interface ConversationNotificationLevelResult {
  conversationId: string;
  level: NotificationLevel | null;
  effectiveLevel: NotificationLevel;
  mutedUntil: string | null;
}

interface SetConversationNotificationLevelVars {
  serverId: string;
  conversationId: string;
  /** null goes back to the workspace default. */
  level: NotificationLevel | null;
}

type LevelPatch = Pick<ConversationSummary, "notificationLevel" | "effectiveNotificationLevel">;

/** Writes the viewer's level into every cache that holds the conversation (header, sidebar). */
export function patchConversationLevel(
  qc: QueryClient,
  serverId: string,
  conversationId: string,
  patch: LevelPatch,
): void {
  qc.setQueryData<ConversationSummary>(queryKeys.conversation(serverId, conversationId), (old) =>
    old ? { ...old, ...patch } : old,
  );
  for (const key of [
    queryKeys.joinedChannels(serverId),
    queryKeys.channels(serverId),
    queryKeys.conversations(serverId),
  ]) {
    qc.setQueryData<ConversationSummaryPage>(key, (old) =>
      old
        ? {
            ...old,
            items: old.items.map((c) => (c.id === conversationId ? { ...c, ...patch } : c)),
          }
        : old,
    );
  }
}

function isMutedNow(result: ConversationNotificationLevelResult): boolean {
  if (result.level === NotificationLevel.NONE) return true;
  return result.mutedUntil !== null && Date.parse(result.mutedUntil) > Date.now();
}

/** Sets (or, with `level: null`, clears) the viewer's notification level for a conversation. */
export function useSetConversationNotificationLevel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      serverId,
      conversationId,
      level,
    }: SetConversationNotificationLevelVars) => {
      const res = await graphqlClient.request<{
        setConversationNotificationLevel: ConversationNotificationLevelResult;
      }>(SET_CONVERSATION_NOTIFICATION_LEVEL, { serverId, conversationId, level });
      return res.setConversationNotificationLevel;
    },
    onSuccess: (result, { serverId, conversationId }) => {
      patchConversationLevel(qc, serverId, conversationId, {
        notificationLevel: result.level,
        effectiveNotificationLevel: result.effectiveLevel,
      });
      const muted = useMutedStore.getState();
      if (isMutedNow(result)) muted.mute(conversationId);
      else muted.unmute(conversationId);
      qc.invalidateQueries({ queryKey: queryKeys.mutedConversations(serverId) });
    },
  });
}
