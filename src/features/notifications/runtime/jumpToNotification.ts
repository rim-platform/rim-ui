import type { QueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { logger } from "../../../core/logger";
import { useShellStore } from "../../../shell/state/useShellStore";

const THREAD_ROOT = gql`
  query NotificationThreadRoot($serverId: ID!, $conversationId: ID!, $threadId: ID!) {
    thread(serverId: $serverId, conversationId: $conversationId, threadId: $threadId) {
      id
      rootMessageId
    }
  }
`;

interface JumpTarget {
  serverId: string;
  conversationId: string;
  messageId: string;
  /** Set for a thread reply: the thread opens on its root and the reply is highlighted. */
  threadId: string | null;
}

async function threadRootMessageId(
  qc: QueryClient,
  { serverId, conversationId, threadId }: JumpTarget & { threadId: string },
): Promise<string | null> {
  try {
    const thread = await qc.fetchQuery({
      queryKey: ["notificationThreadRoot", serverId, conversationId, threadId],
      staleTime: Infinity,
      queryFn: async () => {
        const res = await graphqlClient.request<{
          thread: { id: string; rootMessageId: string | null };
        }>(THREAD_ROOT, { serverId, conversationId, threadId });
        return res.thread;
      },
    });
    return thread.rootMessageId;
  } catch (err) {
    logger.warn("[RIM:notifications] Could not resolve the thread root:", err);
    return null;
  }
}

/**
 * Opens the notification's message the way a search result does: select the conversation and
 * highlight the message, opening the thread first for a thread reply.
 */
export async function jumpToNotification(qc: QueryClient, target: JumpTarget): Promise<void> {
  const shell = useShellStore.getState();
  shell.setMainSurface({ kind: "conversation" });
  shell.setSelectedConversationId(target.conversationId);

  if (target.threadId) {
    const rootMessageId = await threadRootMessageId(qc, { ...target, threadId: target.threadId });
    // The viewer may have moved on while the root was loading.
    if (useShellStore.getState().selectedConversationId !== target.conversationId) return;
    if (rootMessageId) {
      useShellStore.getState().openThreadForMessage(rootMessageId);
    }
  }
  useShellStore.getState().setHighlightedMessageId(target.messageId);
}
