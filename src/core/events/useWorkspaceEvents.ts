import { useEffect, useRef } from "react";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";

import {
  handleMemberBanChanged,
  handleMemberProfileUpdated,
} from "../../features/workspaces/state/memberEvents";
import { useRecentActivityStore } from "../../features/conversations/state/useRecentActivityStore";
import { useBlockedConversations } from "../../features/relay/state/useBlockedConversations";
import { wsClient, onWsConnected } from "../graphql/wsClient";
import { isSessionEndedClose, reportSubscriptionLimit } from "../graphql/subscriptionErrors";
import { logger } from "../logger";
import { toast } from "../../shared/toast";
import { queryKeys, VOLATILE_WORKSPACE_KEY_ROOTS } from "../query/keys";
import type { WorkspaceEvent } from "./types";
import type { Pipeline } from "../../features/pipelines/api/usePipelines";
import { pipelineTriggerPhrase } from "../../features/pipelines/pipelineFired";
import type { MessagesPage } from "../types/messages";
import { eventBus } from "./eventBus";
import { BUS_EVENTS } from "./busEvents";
import { requestCacheSync } from "../../features/messages/runtime/messageCacheSync";
import {
  insertTimelineMessage,
  messageFromEvent,
} from "../../features/messages/api/timelineMessages";
import { handleE2eeEvent } from "../../features/e2ee/runtime/e2eeRuntime";
import { setMessageFlagged } from "./messageFlag";
import { hostOf } from "../../features/relay/state/useRelayStore";
import { applyWorkspaceName } from "../../features/workspaces/state/workspaceName";
import { useContactStore } from "../../features/relay/contacts/useContactStore";
import { cachedMember, memberName } from "../../features/workspaces/api/memberName";
import {
  handleConversationUpdated,
  handleMemberAddedToConversation,
  handleMemberRemovedFromConversation,
  handleWorkspaceMemberJoined,
} from "../../features/conversations/state/membershipEvents";
import {
  handleMemberLeft,
  handleMemberRoleChanged,
} from "../../features/workspaces/state/memberEvents";
import {
  handleMessagesDeleted,
  handleNotificationDue,
  handleReadStateUpdated,
  handleViewerMembershipChange,
} from "../../features/notifications/state/notificationEvents";
import {
  handleJoinRequestCreated,
  handleJoinRequestDecided,
} from "../../features/workspaces/state/joinRequestEvents";
import type {
  UnreadIncrementEvent,
  UnreadMarkReadEvent,
  PresenceChangedEvent,
  TypingStartedEvent,
  TypingStoppedEvent,
  WorkspaceStateChangedEvent,
  WorkspaceStateDeletedEvent,
  PipelineFiredEvent,
  PipelineSuspendedEvent,
} from "./busEvents";

const WORKSPACE_EVENTS_QUERY = `
  subscription WorkspaceEvents($workspaceId: ID!) {
    workspaceEvents(workspaceId: $workspaceId)
  }
`;

/**
 * Reconnect cache-invalidation strategy: events that occur *during* a WS
 * disconnect are lost (the subscription has no resume-since-cursor), so on
 * reconnect anything workspace-scoped that flows through `workspaceEvents`
 * may be stale. Only the active workspace's volatile server-state keys
 * (`VOLATILE_WORKSPACE_KEY_ROOTS` in `core/query/keys.ts`) are invalidated
 * rather than the whole cache, and the very first connect is skipped (initial
 * page load already fetches everything fresh).
 */
export function useWorkspaceEvents(workspaceId: string | null) {
  const qc = useQueryClient();
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const workspaceIdRef = useRef(workspaceId);
  workspaceIdRef.current = workspaceId;
  const hasConnectedRef = useRef(false);

  // Invalidate the active workspace's volatile queries on WebSocket reconnect
  // to catch up on missed events (see file-header comment for the strategy).
  useEffect(() => {
    const unsubscribe = onWsConnected(() => {
      if (!hasConnectedRef.current) {
        hasConnectedRef.current = true; // initial connect — cache is already fresh
        return;
      }
      const wsId = workspaceIdRef.current;
      if (!wsId) return;
      logger.debug("[RIM:WS] Reconnected — invalidating active-workspace volatile keys");
      for (const root of VOLATILE_WORKSPACE_KEY_ROOTS) {
        qc.invalidateQueries({ queryKey: [root, wsId] });
      }
      toast.success("Reconnected", {
        id: "ws-reconnect",
        description: "Real-time connection restored.",
      });
    });
    return unsubscribe;
  }, [qc]);

  useEffect(() => {
    // A space on another server reaches this app through the relay's `relayStream` instead.
    if (!workspaceId || hostOf(workspaceId)) return;

    // Names renamed while another workspace was open.
    void qc.invalidateQueries({ queryKey: queryKeys.myServers() });

    logger.debug("[RIM:WS] Subscribing to workspace events for:", workspaceId);

    // Clean up previous subscription
    unsubscribeRef.current?.();

    const cleanup = wsClient.subscribe<{ workspaceEvents: string }>(
      {
        query: WORKSPACE_EVENTS_QUERY,
        variables: { workspaceId },
      },
      {
        next: (result) => {
          if (!result.data?.workspaceEvents) return;

          try {
            const event: WorkspaceEvent = JSON.parse(result.data.workspaceEvents);
            applyWorkspaceEvent(event, qc, workspaceId);
          } catch (err) {
            logger.warn("[RIM:WS] Failed to parse event:", err);
          }
        },
        error: (err) => {
          if (reportSubscriptionLimit("[RIM:WS] workspaceEvents", err)) return;
          // The session ended: the app signs out, nothing to report here.
          if (isSessionEndedClose(err)) return;
          logger.error("[RIM:WS] Subscription error:", err);
        },
        complete: () => {
          logger.debug("[RIM:WS] Subscription completed");
        },
      },
    );

    unsubscribeRef.current = cleanup;

    return () => {
      cleanup();
      unsubscribeRef.current = null;
    };
  }, [workspaceId, qc]);
}

/**
 * Records where a new message was posted in the recent-activity log; the log leaves out the
 * signed-in user's own messages, and so does this for a conversation hidden because someone
 * this account blocked started it.
 */
function recordActivity(
  workspaceId: string,
  message: Extract<WorkspaceEvent, { type: "NewMessage" }>["message"],
) {
  if (useBlockedConversations.getState().bySpace[workspaceId]?.[message.conversation_id]) return;
  useRecentActivityStore.getState().record({
    workspaceId,
    conversationId: message.conversation_id,
    threadId: message.thread_id,
    authorId: message.author_id,
  });
}

/**
 * The name shown for whoever started typing: the alias this person gave them as a contact, else
 * the name the event carries, else the cached member's, else "Someone".
 */
function typingName(
  qc: ReturnType<typeof useQueryClient>,
  workspaceId: string,
  event: Extract<WorkspaceEvent, { type: "TypingStarted" }>,
): string {
  const principalId = cachedMember(qc, workspaceId, event.user_id)?.principalId;
  const alias = principalId ? useContactStore.getState().aliases[principalId] : undefined;
  return (
    alias ||
    event.display_name ||
    event.username ||
    memberName(qc, workspaceId, event.user_id) ||
    "Someone"
  );
}

/**
 * Apply one event of `workspaceId` to the caches and stores: from `workspaceEvents` for a space
 * this server hosts, or a verified host event from the relay for a space elsewhere.
 */
export function applyWorkspaceEvent(
  event: WorkspaceEvent,
  qc: ReturnType<typeof useQueryClient>,
  workspaceId: string,
) {
  // Real-time message events carry no change-feed version; for the local message cache they
  // are only a signal to ask the feed for that conversation (no-op outside the desktop app).
  if (
    event.type === "NewMessage" ||
    event.type === "MessageUpdated" ||
    event.type === "MessageDeleted" ||
    event.type === "MessagesDeleted" ||
    event.type === "MessageFlagChanged"
  ) {
    requestCacheSync(workspaceId, [event.conversation_id]);
  }

  // A message from someone ends their typing indicator in that conversation.
  if (event.type === "NewMessage") {
    eventBus.emit<TypingStoppedEvent>(BUS_EVENTS.TYPING_STOPPED, {
      conversationId: event.conversation_id,
      userId: event.message.author_id,
    });
  }

  // An encrypted message carries no text: the cache decrypts it and the timeline re-reads it.
  if (
    (event.type === "NewMessage" || event.type === "MessageUpdated") &&
    event.message.encryption
  ) {
    if (event.type === "NewMessage") {
      recordActivity(workspaceId, event.message);
      eventBus.emit<UnreadIncrementEvent>(BUS_EVENTS.UNREAD_INCREMENT, {
        workspaceId,
        conversationId: event.conversation_id,
        authorId: event.message.author_id,
      });
      // An encrypted thread reply still counts towards its root's reply count.
      if (event.message.thread_id) {
        void qc.invalidateQueries({
          queryKey: ["threadReplyCount", workspaceId, event.conversation_id],
        });
      }
    }
    return;
  }

  switch (event.type) {
    case "MlsCommitAccepted":
    case "MlsMembershipChanged":
    case "MlsWelcomeAvailable":
    case "ConversationUpdated":
      handleE2eeEvent(event, workspaceId);
      break;
    default:
      break;
  }

  switch (event.type) {
    case "NewMessage": {
      insertTimelineMessage(qc, workspaceId, messageFromEvent(event.message));

      recordActivity(workspaceId, event.message);

      // Unread tracking via event bus; the feature filters (own message, active conversation).
      // Desktop notifications are decided by the server and arrive as `NotificationDue`.
      eventBus.emit<UnreadIncrementEvent>(BUS_EVENTS.UNREAD_INCREMENT, {
        workspaceId,
        conversationId: event.conversation_id,
        authorId: event.message.author_id,
      });
      break;
    }

    case "MessageUpdated": {
      const updated = messageFromEvent(event.message);

      void qc.invalidateQueries({
        queryKey: queryKeys.messages(workspaceId, event.conversation_id),
      });
      void qc.invalidateQueries({
        queryKey: ["pinnedMessages", workspaceId, event.conversation_id],
      });

      if (event.message.thread_id) {
        // Thread message — invalidate thread queries
        qc.invalidateQueries({
          queryKey: queryKeys.threadMessages(
            workspaceId,
            event.conversation_id,
            event.message.thread_id,
          ),
        });
      } else {
        qc.setQueryData<InfiniteData<MessagesPage>>(
          queryKeys.messages(workspaceId, event.conversation_id),
          (old) => {
            if (!old) return old;

            return {
              ...old,
              pages: old.pages.map((page) => ({
                ...page,
                items: page.items.map((m) => {
                  if (m.id !== updated.id) return m;
                  // Preserve fields the event doesn't carry
                  return {
                    ...m,
                    text: updated.text,
                    isDeleted: updated.isDeleted,
                    sentAt: updated.sentAt,
                    editedAt: event.message.edited_at ?? m.editedAt,
                  };
                }),
              })),
            };
          },
        );
      }
      break;
    }

    case "MessageFlagChanged": {
      setMessageFlagged(qc, workspaceId, event.conversation_id, event.message_id, event.flagged);
      void qc.invalidateQueries({
        queryKey: queryKeys.messages(workspaceId, event.conversation_id),
      });
      void qc.invalidateQueries({
        queryKey: ["pinnedMessages", workspaceId, event.conversation_id],
      });
      // The event names no thread: every cached thread of the conversation may hold it.
      void qc.invalidateQueries({
        queryKey: ["threadMessages", workspaceId, event.conversation_id],
      });
      break;
    }

    case "MessageDeleted": {
      if (event.thread_id) {
        // Thread message — invalidate thread queries
        qc.invalidateQueries({
          queryKey: queryKeys.threadMessages(workspaceId, event.conversation_id, event.thread_id),
        });
        qc.invalidateQueries({
          queryKey: ["threadByRoot", workspaceId, event.conversation_id],
        });
        qc.invalidateQueries({
          queryKey: ["threadReplyCount", workspaceId, event.conversation_id],
        });
      } else {
        qc.setQueryData<InfiniteData<MessagesPage>>(
          queryKeys.messages(workspaceId, event.conversation_id),
          (old) => {
            if (!old) return old;

            return {
              ...old,
              pages: old.pages.map((page) => ({
                ...page,
                items: page.items.map((m) =>
                  m.id === event.message_id ? { ...m, isDeleted: true, text: "" } : m,
                ),
              })),
            };
          },
        );
      }
      break;
    }

    case "MessagesDeleted": {
      const conversationId = event.conversation_id;
      const gone = new Set(event.message_ids);
      qc.setQueryData<InfiniteData<MessagesPage>>(
        queryKeys.messages(workspaceId, conversationId),
        (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.map((m) =>
                gone.has(m.id) ? { ...m, isDeleted: true, text: "" } : m,
              ),
            })),
          };
        },
      );
      // A timeline read already under way (a ban refetches it) may answer from before the
      // delete and overwrite the patch above; refetching replaces that read.
      void qc.invalidateQueries({ queryKey: queryKeys.messages(workspaceId, conversationId) });
      for (const threadId of event.thread_ids) {
        void qc.invalidateQueries({
          queryKey: queryKeys.threadMessages(workspaceId, conversationId, threadId),
        });
      }
      if (event.thread_ids.length > 0) {
        void qc.invalidateQueries({ queryKey: ["threadByRoot", workspaceId, conversationId] });
        void qc.invalidateQueries({ queryKey: ["threadReplyCount", workspaceId, conversationId] });
      }
      // A bulk delete usually removes spam that sits in pins, search hits, unread counts and
      // mention notifications, all of which the server already dropped.
      void qc.invalidateQueries({ queryKey: ["pinnedMessages", workspaceId, conversationId] });
      void qc.invalidateQueries({ queryKey: ["searchMessages", workspaceId] });
      void qc.invalidateQueries({ queryKey: queryKeys.unreadCounts(workspaceId) });
      handleMessagesDeleted(qc, workspaceId);
      break;
    }

    case "ReactionsUpdated":
      // Update reactions in-place for the specific message.
      // The event doesn't carry reactedByMe, so preserve the old value.
      qc.setQueryData<InfiniteData<MessagesPage>>(
        queryKeys.messages(workspaceId, event.conversation_id),
        (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.map((m) => {
                if (m.id !== event.message_id) return m;
                const updatedReactions = event.reactions.map((r) => {
                  const existing = m.reactions.find((er) => er.emoji === r.emoji);
                  return {
                    emoji: r.emoji,
                    count: r.count,
                    reactedByMe: existing?.reactedByMe ?? false,
                    userIds: r.user_ids ?? existing?.userIds ?? [],
                  };
                });
                return { ...m, reactions: updatedReactions };
              }),
            })),
          };
        },
      );
      // Also mark as stale so reactedByMe gets refreshed on next focus
      qc.invalidateQueries({
        queryKey: queryKeys.messages(workspaceId, event.conversation_id),
        refetchType: "none",
      });
      break;

    case "ConversationCreated":
      // Invalidate both channel and conversation lists
      qc.invalidateQueries({ queryKey: queryKeys.channels(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.conversations(workspaceId) });
      break;

    case "MemberProfileUpdated":
      handleMemberProfileUpdated(qc, workspaceId, event.user_id);
      break;

    case "MemberJoined":
      // Invalidate member list
      qc.invalidateQueries({ queryKey: queryKeys.serverMembers(workspaceId) });
      handleWorkspaceMemberJoined(qc, workspaceId);
      // A join through the public link counts in the Owner's link statistics.
      if (event.source === "public_link") {
        qc.invalidateQueries({ queryKey: queryKeys.publicJoinLink(workspaceId) });
      }
      break;

    // These carry the workspace asked to join, which is not the subscription's space for the
    // person asking: they hear it on their direct-space subscription.
    case "JoinRequestCreated":
      handleJoinRequestCreated(qc, event);
      break;

    case "JoinRequestDecided":
      void handleJoinRequestDecided(qc, event);
      break;

    case "MemberLeft":
      handleViewerMembershipChange(qc, workspaceId, event.user_id);
      handleMemberLeft(qc, workspaceId, event.user_id, event);
      handleMemberBanChanged(qc, workspaceId);
      break;

    case "MemberBanChanged":
      handleMemberBanChanged(qc, workspaceId);
      break;

    case "MemberRoleChanged":
      handleMemberRoleChanged(qc, workspaceId, event.user_id, event.role);
      break;

    case "ThreadCreated":
      // Invalidate conversation messages so root message gets updated with rootThreadId
      qc.invalidateQueries({
        queryKey: queryKeys.messages(workspaceId, event.conversation_id),
      });
      // Invalidate thread lookup for the root message
      qc.invalidateQueries({
        queryKey: queryKeys.threadByRoot(workspaceId, event.conversation_id, event.root_message_id),
      });
      break;

    case "ReadStateUpdated":
      // Multi-device sync — another client marked conversation as read
      eventBus.emit<UnreadMarkReadEvent>(BUS_EVENTS.UNREAD_MARK_READ, {
        conversationId: event.conversation_id,
      });
      handleReadStateUpdated(qc, workspaceId);
      break;

    case "PresenceChanged": {
      eventBus.emit<PresenceChangedEvent>(BUS_EVENTS.PRESENCE_CHANGED, {
        userId: event.user_id,
        status: event.status,
      });
      break;
    }

    case "MemberAddedToConversation":
      handleMemberAddedToConversation(qc, workspaceId, event.conversation_id);
      break;

    case "MemberRemovedFromConversation":
      handleMemberRemovedFromConversation(qc, workspaceId, event.conversation_id, event.user_id);
      handleViewerMembershipChange(qc, workspaceId, event.user_id);
      break;

    case "ConversationUpdated":
      handleConversationUpdated(qc, workspaceId, event.conversation_id);
      break;

    case "TypingStarted": {
      eventBus.emit<TypingStartedEvent>(BUS_EVENTS.TYPING_STARTED, {
        conversationId: event.conversation_id,
        userId: event.user_id,
        username: typingName(qc, workspaceId, event),
      });
      break;
    }

    // Mentions are announced by the `NotificationDue` the server sends for them, which honours
    // the viewer's levels and do-not-disturb; `UserMentioned` needs no rendering of its own.
    case "UserMentioned":
      break;

    case "NotificationDue":
      handleNotificationDue(qc, workspaceId, event);
      break;

    case "LinkPreviewReady":
      // Backend finished fetching link preview metadata — refresh the message
      qc.invalidateQueries({
        queryKey: queryKeys.messages(workspaceId, event.conversation_id),
      });
      break;

    case "WorkspaceStateChanged": {
      qc.invalidateQueries({
        queryKey: queryKeys.workspaceState(workspaceId, event.scope, event.key),
      });
      qc.invalidateQueries({
        queryKey: ["workspaceStateList", workspaceId], // Broad prefix match — invalidates all scopes/prefixes
      });
      eventBus.emit<WorkspaceStateChangedEvent>(BUS_EVENTS.WORKSPACE_STATE_CHANGED, {
        workspaceId,
        key: event.key,
        scope: event.scope,
      });
      break;
    }

    case "WorkspaceStateDeleted": {
      qc.invalidateQueries({
        queryKey: queryKeys.workspaceState(workspaceId, event.scope, event.key),
      });
      qc.invalidateQueries({
        queryKey: ["workspaceStateList", workspaceId], // Broad prefix match — invalidates all scopes/prefixes
      });
      eventBus.emit<WorkspaceStateDeletedEvent>(BUS_EVENTS.WORKSPACE_STATE_DELETED, {
        workspaceId,
        key: event.key,
        scope: event.scope,
      });
      break;
    }

    case "MessagePinned":
      qc.setQueryData<InfiniteData<MessagesPage>>(
        queryKeys.messages(workspaceId, event.conversation_id),
        (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.map((m) =>
                m.id === event.message_id ? { ...m, isPinned: true } : m,
              ),
            })),
          };
        },
      );
      qc.invalidateQueries({
        queryKey: queryKeys.pinnedMessages(workspaceId, event.conversation_id),
      });
      break;

    case "MessageUnpinned":
      qc.setQueryData<InfiniteData<MessagesPage>>(
        queryKeys.messages(workspaceId, event.conversation_id),
        (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.map((m) =>
                m.id === event.message_id ? { ...m, isPinned: false } : m,
              ),
            })),
          };
        },
      );
      qc.invalidateQueries({
        queryKey: queryKeys.pinnedMessages(workspaceId, event.conversation_id),
      });
      break;

    case "PipelineFired": {
      // The server runs at most 10 of a pipeline's actions per firing.
      const pipeline = qc
        .getQueryData<Pipeline[]>(queryKeys.pipelines(workspaceId))
        ?.find((p) => p.id === event.pipeline_id);
      const total = pipeline ? Math.min(pipeline.actions.length, 10) : undefined;
      const ran = event.actions_executed;
      // Refresh pipeline list so lastFiredAt updates in the UI
      qc.invalidateQueries({ queryKey: queryKeys.pipelines(workspaceId) });
      const phrase = pipelineTriggerPhrase(event.trigger_event);
      const trigger = phrase ? ` ${phrase}` : "";
      const description =
        total !== undefined
          ? `${ran} of ${total} action${total !== 1 ? "s" : ""} ran${trigger}`
          : `${ran} action${ran !== 1 ? "s" : ""} ran${trigger}`;
      const show = total !== undefined && ran < total ? toast.warning : toast.success;
      show(`Pipeline "${event.pipeline_name}" fired`, { description });
      eventBus.emit<PipelineFiredEvent>(BUS_EVENTS.PIPELINE_FIRED, {
        workspaceId,
        pipelineId: event.pipeline_id,
        pipelineName: event.pipeline_name,
        triggerEvent: event.trigger_event,
        actionsExecuted: event.actions_executed,
      });
      break;
    }

    case "WorkspacePluginChanged":
      qc.invalidateQueries({ queryKey: queryKeys.workspacePlugins(workspaceId) });
      break;

    case "WorkspaceUpdated":
      applyWorkspaceName(qc, workspaceId, event.name);
      break;

    case "PipelineSuspended": {
      // Refresh pipeline list so enabled status updates
      qc.invalidateQueries({ queryKey: queryKeys.pipelines(workspaceId) });
      toast.error(`Pipeline "${event.pipeline_name}" suspended`, {
        description: event.reason,
      });
      eventBus.emit<PipelineSuspendedEvent>(BUS_EVENTS.PIPELINE_SUSPENDED, {
        workspaceId,
        pipelineId: event.pipeline_id,
        pipelineName: event.pipeline_name,
        reason: event.reason,
      });
      break;
    }
  }
}
