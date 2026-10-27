import { useEffect, useRef } from "react";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { PresenceStatus } from "../../../core/graphql/generated/schema-types";
import { usePresenceStore } from "../state/usePresenceStore";

const HEARTBEAT_MUTATION = gql`
  mutation Heartbeat($input: HeartbeatInput!) {
    heartbeat(input: $input)
  }
`;

/**
 * Sends this client's presence in `workspaceId` every 30 s and on visibility changes, and keeps
 * the signed-in user's own dot in the presence store at the status it sends.
 */
export function useHeartbeat(workspaceId: string | null, userId: string | null) {
  const lastSentRef = useRef(0);

  useEffect(() => {
    if (!workspaceId) return;

    const sendHeartbeat = (status: PresenceStatus) => {
      if (userId) usePresenceStore.getState().setSelf(userId, status);
      const now = Date.now();
      if (now - lastSentRef.current < 10_000) return;
      lastSentRef.current = now;
      graphqlClient
        .request(HEARTBEAT_MUTATION, {
          input: { workspaceId, status },
        })
        .catch(() => {}); // silently fail
    };

    // Send initial heartbeat
    sendHeartbeat(PresenceStatus.ONLINE);

    // Periodic heartbeat every 30s
    const interval = setInterval(() => {
      const isVisible = document.visibilityState === "visible";
      sendHeartbeat(isVisible ? PresenceStatus.ONLINE : PresenceStatus.AWAY);
    }, 30_000);

    // Visibility change → immediate heartbeat
    const handleVisibility = () => {
      sendHeartbeat(
        document.visibilityState === "visible" ? PresenceStatus.ONLINE : PresenceStatus.AWAY,
      );
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [workspaceId, userId]);
}
