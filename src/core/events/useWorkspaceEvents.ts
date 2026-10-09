import { useEffect, useRef } from "react";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { wsClient, onWsConnected } from "../graphql/wsClient";
import { logger } from "../logger";
import { toast } from "../../shared/toast";
import { queryKeys, VOLATILE_WORKSPACE_KEY_ROOTS, VOLATILE_GLOBAL_KEY_ROOTS } from "../query/keys";
import type { WorkspaceEvent, MessageEventData } from "./types";
import type { MessageItem, MessagesPage } from "../types/messages";
import { eventBus } from "./eventBus";
import { BUS_EVENTS } from "./busEvents";
import { useExecuteCommandMutation } from "../../features/commands/api/useCommands";
import { requestCacheSync } from "../../features/messages/runtime/messageCacheSync";
import { handleE2eeEvent } from "../../features/e2ee/runtime/e2eeRuntime";
import {
  handleConversationUpdated,
  handleMemberAddedToConversation,
  handleMemberRemovedFromConversation,
} from "../../features/conversations/state/membershipEvents";
import {
  handleMemberLeft,
  handleMemberRoleChanged,
} from "../../features/workspaces/state/memberEvents";
import {
  handleNotificationDue,
  handleReadStateUpdated,
  handleViewerMembershipChange,
} from "../../features/notifications/state/notificationEvents";
import type {
  UnreadIncrementEvent,
  UnreadMarkReadEvent,
  PresenceChangedEvent,
  TypingStartedEvent,
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
 * disconnect are currently lost (there's no resume-since-cursor yet), so on
 * reconnect we must assume anything workspace-scoped that flows through
 * `workspaceEvents` may be stale. We invalidate only the active workspace's
 * volatile server-state keys (`VOLATILE_WORKSPACE_KEY_ROOTS` /
 * `VOLATILE_GLOBAL_KEY_ROOTS` in `core/query/keys.ts`) rather than the whole
 * cache, and skip the very first connect (initial page load already fetches
 * everything fresh). Track B will add a resume-since-cursor to the
 * subscription so reconnects can replay only what was actually missed,
 * making this blanket-but-scoped invalidation unnecessary.
 */
export function useWorkspaceEvents(workspaceId: string | null) {
  const qc = useQueryClient();
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const workspaceIdRef = useRef(workspaceId);
  workspaceIdRef.current = workspaceId;
  const hasConnectedRef = useRef(false);

  // Ack from the paged-toast inline action dispatches through the same `incident.ack`
  // command as the banner button and keybind (see IncidentBanner.tsx / commandDispatcher.ts).
  // Kept in a ref (same pattern as `workspaceIdRef`) so the subscription effect below
  // doesn't need to resubscribe every time the mutation object's identity changes.
  const executeCommandMutation = useExecuteCommandMutation();
  const executeCommandRef = useRef(executeCommandMutation);
  executeCommandRef.current = executeCommandMutation;

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
      for (const root of VOLATILE_GLOBAL_KEY_ROOTS) {
        qc.invalidateQueries({ queryKey: [root] });
      }
      toast.success("Reconnected", {
        id: "ws-reconnect",
        description: "Real-time connection restored.",
      });
    });
    return unsubscribe;
  }, [qc]);

  useEffect(() => {
    if (!workspaceId) return;

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
            handleEvent(event, qc, workspaceId, executeCommandRef.current.mutate);
          } catch (err) {
            logger.warn("[RIM:WS] Failed to parse event:", err);
          }
        },
        error: (err) => {
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

function eventMessageToCache(msg: MessageEventData): MessageItem {
  return {
    id: msg.id,
    serverId: msg.server_id,
    conversationId: msg.conversation_id,
    threadId: msg.thread_id ?? null,
    rootThreadId: msg.root_thread_id ?? null,
    authorId: msg.author_id,
    author: null,
    text: msg.text ?? "",
    hasAttachments: msg.has_attachments ?? false,
    parentMessageId: msg.parent_message_id ?? null,
    isPinned: false,
    mentionedUserIds: [],
    forwardedFromMessageId: msg.forwarded_from_message_id ?? null,
    forwardedFrom: null,
    isDeleted: msg.is_deleted,
    sentAt: msg.sent_at,
    reactions: [],
    attachments: [],
    linkPreviews: [],
  };
}

type AckMutate = ReturnType<typeof useExecuteCommandMutation>["mutate"];

function handleEvent(
  event: WorkspaceEvent,
  qc: ReturnType<typeof useQueryClient>,
  workspaceId: string,
  ackIncident: AckMutate,
) {
  // Real-time message events carry no change-feed version; for the local message cache they
  // are only a signal to ask the feed for that conversation (no-op outside the desktop app).
  if (
    event.type === "NewMessage" ||
    event.type === "MessageUpdated" ||
    event.type === "MessageDeleted"
  ) {
    requestCacheSync(workspaceId, [event.conversation_id]);
  }

  // An encrypted message carries no text: the cache decrypts it and the timeline re-reads it.
  if (
    (event.type === "NewMessage" || event.type === "MessageUpdated") &&
    event.message.encryption
  ) {
    if (event.type === "NewMessage") {
      eventBus.emit<UnreadIncrementEvent>(BUS_EVENTS.UNREAD_INCREMENT, {
        conversationId: event.conversation_id,
        authorId: event.message.author_id,
      });
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
      const cacheMessage = eventMessageToCache(event.message);
      cacheMessage.serverId = workspaceId;

      if (event.message.thread_id) {
        // Thread reply — invalidate thread messages and thread metadata
        qc.invalidateQueries({
          queryKey: queryKeys.threadMessages(
            workspaceId,
            event.conversation_id,
            event.message.thread_id,
          ),
        });
        // Invalidate threadByRoot so reply count / lastMessageAt updates
        qc.invalidateQueries({
          queryKey: ["threadByRoot", workspaceId, event.conversation_id],
        });
      } else {
        // Main conversation message — update cache directly
        qc.setQueryData<InfiniteData<MessagesPage>>(
          queryKeys.messages(workspaceId, event.conversation_id),
          (old) => {
            if (!old) return old;
            const firstPage = old.pages[0];
            if (!firstPage) return old;

            // Deduplicate — skip if message already exists
            const exists = old.pages.some((p) => p.items.some((m) => m.id === cacheMessage.id));
            if (exists) return old;

            // Items are now oldest-first, so append new message at the end
            return {
              ...old,
              pages: [
                { ...firstPage, items: [...firstPage.items, cacheMessage] },
                ...old.pages.slice(1),
              ],
            };
          },
        );
      }

      // Unread tracking via event bus; the feature filters (own message, active conversation).
      // Desktop notifications are decided by the server and arrive as `NotificationDue`.
      eventBus.emit<UnreadIncrementEvent>(BUS_EVENTS.UNREAD_INCREMENT, {
        conversationId: event.conversation_id,
        authorId: event.message.author_id,
      });
      break;
    }

    case "MessageUpdated": {
      const updated = eventMessageToCache(event.message);
      updated.serverId = workspaceId;

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
                  };
                }),
              })),
            };
          },
        );
      }
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

    case "MemberJoined":
      // Invalidate member list
      qc.invalidateQueries({ queryKey: queryKeys.serverMembers(workspaceId) });
      break;

    case "MemberLeft":
      handleViewerMembershipChange(qc, workspaceId, event.user_id);
      handleMemberLeft(qc, workspaceId, event.user_id);
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
        username: event.username,
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
      // Refresh pipeline list so lastFiredAt updates in the UI
      qc.invalidateQueries({ queryKey: queryKeys.pipelines(workspaceId) });
      toast.success(`Pipeline "${event.pipeline_name}" fired`, {
        description: `${event.actions_executed} action${event.actions_executed !== 1 ? "s" : ""} executed (trigger: ${event.trigger_event})`,
      });
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

    // Incident UI (IncidentTimelinePanel, IncidentHistoryPage, the active-incident
    // banner) is TanStack-Query-driven, so scoped cache invalidation is sufficient —
    // no new event-bus channel needed. Pipelines already react to incident events
    // server-side (track-b2-alerts.md §8), so the frontend does not re-trigger
    // anything here.
    case "IncidentDeclared": {
      qc.invalidateQueries({
        queryKey: queryKeys.activeIncident(workspaceId, event.conversation_id),
      });
      // Broad prefix — listIncidents keys status/severity filters after serverId.
      qc.invalidateQueries({ queryKey: ["listIncidents", workspaceId] });
      qc.invalidateQueries({
        queryKey: queryKeys.incidentTimeline(event.incident_id),
      });
      toast.info(`Incident declared: ${event.title}`, {
        description: event.severity ? `Severity: ${event.severity}` : undefined,
      });
      break;
    }

    case "IncidentUpdated": {
      qc.invalidateQueries({
        queryKey: queryKeys.activeIncident(workspaceId, event.conversation_id),
      });
      qc.invalidateQueries({ queryKey: ["listIncidents", workspaceId] });
      qc.invalidateQueries({
        queryKey: queryKeys.incidentTimeline(event.incident_id),
      });
      // No toast here (unlike IncidentDeclared) — repeated alert firings on the
      // same incident would otherwise spam the user; cache invalidation alone
      // keeps the query-driven incident panels current.
      break;
    }

    case "EscalationStepFired": {
      qc.invalidateQueries({
        queryKey: queryKeys.activeIncident(workspaceId, event.conversation_id),
      });
      qc.invalidateQueries({ queryKey: ["listIncidents", workspaceId] });
      qc.invalidateQueries({ queryKey: queryKeys.incidentTimeline(event.incident_id) });

      const me = qc.getQueryData<{ id: string }>(queryKeys.me);
      if (me && event.target_user_ids.includes(me.id)) {
        const incidentId = event.incident_id;
        toast.warning("You're being paged for an incident", {
          id: `paged-${incidentId}`,
          persistent: true,
          description: "An escalation step just fired — ack to stop further escalation.",
          action: {
            label: "Ack",
            onClick: () => {
              // Dispatches the SAME `incident.ack` command as the banner button and
              // keybind — see IncidentBanner.tsx / commandDispatcher.ts.
              ackIncident(
                { commandId: "incident.ack", args: { incidentId } },
                {
                  onSuccess: (res) => {
                    if (res.executeCommand.status === "ERROR") {
                      toast.error(res.executeCommand.message || "Failed to acknowledge incident");
                      return;
                    }
                    qc.invalidateQueries({
                      queryKey: queryKeys.activeIncident(workspaceId, event.conversation_id),
                    });
                    qc.invalidateQueries({ queryKey: queryKeys.incidentTimeline(incidentId) });
                    toast.dismiss(`paged-${incidentId}`);
                  },
                  onError: () => toast.error("Failed to acknowledge incident"),
                },
              );
            },
          },
        });
      }
      break;
    }

    case "IncidentAcknowledged": {
      qc.invalidateQueries({
        queryKey: queryKeys.activeIncident(workspaceId, event.conversation_id),
      });
      qc.invalidateQueries({ queryKey: ["listIncidents", workspaceId] });
      qc.invalidateQueries({ queryKey: queryKeys.incidentTimeline(event.incident_id) });
      toast.dismiss(`paged-${event.incident_id}`);
      break;
    }
  }
}
