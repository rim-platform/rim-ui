import { useEffect, useRef } from "react";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";

const HEARTBEAT_MUTATION = gql`
  mutation Heartbeat($input: HeartbeatInput!) {
    heartbeat(input: $input)
  }
`;

export function useHeartbeat(workspaceId: string | null) {
  const lastSentRef = useRef(0);

  useEffect(() => {
    if (!workspaceId) return;

    const sendHeartbeat = (status: "ONLINE" | "AWAY") => {
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
    sendHeartbeat("ONLINE");

    // Periodic heartbeat every 30s
    const interval = setInterval(() => {
      const isVisible = document.visibilityState === "visible";
      sendHeartbeat(isVisible ? "ONLINE" : "AWAY");
    }, 30_000);

    // Visibility change → immediate heartbeat
    const handleVisibility = () => {
      sendHeartbeat(
        document.visibilityState === "visible" ? "ONLINE" : "AWAY",
      );
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [workspaceId]);
}
