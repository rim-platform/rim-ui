import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { onWsConnected, wsClient } from "../../../core/graphql/wsClient";
import {
  isSessionEndedClose,
  reportSubscriptionLimit,
} from "../../../core/graphql/subscriptionErrors";
import type { NotificationDueEvent } from "../../../core/graphql/generated/schema-types";
import type { NotificationDueReason } from "../../../core/events/types";
import { logger } from "../../../core/logger";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { NOTIFICATION_EVENTS, serverHasCapability } from "../../updater/api/serverCapabilities";
import { announceNotificationDue } from "../state/notificationEvents";

/** The viewer's notifications from every workspace on this server. */
export const NOTIFICATION_EVENTS_SUBSCRIPTION = `
  subscription NotificationEvents {
    notificationEvents {
      workspaceId
      notificationId
      conversationId
      messageId
      reason
      quiet
    }
  }
`;

type NotificationEventFields = Pick<
  NotificationDueEvent,
  "workspaceId" | "notificationId" | "conversationId" | "messageId" | "reason" | "quiet"
>;

/**
 * Subscribes to the viewer's notifications from every workspace on this server, once it lists the
 * capability; on an older server only the open workspace and the direct space notify. The check
 * runs again each time the WebSocket connects, so a start without the server still subscribes
 * when it comes back. Mounted once, from sign-in.
 */
export function useNotificationEvents(): void {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.session?.userId ?? null);

  useEffect(() => {
    if (!userId) return;
    let ended = false;
    let stop: (() => void) | undefined;

    const start = async () => {
      if (ended || stop) return;
      if (!(await serverHasCapability(NOTIFICATION_EVENTS))) return;
      if (ended || stop) return;
      stop = wsClient.subscribe<{ notificationEvents: NotificationEventFields }>(
        { query: NOTIFICATION_EVENTS_SUBSCRIPTION },
        {
          next: (result) => {
            const due = result.data?.notificationEvents;
            if (!due) return;
            announceNotificationDue(qc, {
              workspaceId: due.workspaceId,
              notificationId: due.notificationId,
              conversationId: due.conversationId,
              messageId: due.messageId,
              reason: due.reason.toLowerCase() as NotificationDueReason,
              quiet: due.quiet,
            });
          },
          error: (err) => {
            if (reportSubscriptionLimit("[RIM:WS] notificationEvents", err)) return;
            if (isSessionEndedClose(err)) return;
            logger.error("[RIM:WS] notificationEvents error:", err);
          },
          complete: () => {},
        },
      );
    };

    void start();
    const unsubscribe = onWsConnected(() => void start());
    return () => {
      ended = true;
      unsubscribe();
      stop?.();
    };
  }, [userId, qc]);
}
