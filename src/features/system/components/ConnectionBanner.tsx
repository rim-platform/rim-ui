import { useEffect, useState } from "react";

import { useConnectionStore } from "../state/useConnectionStore";
import { ADDRESS_BLOCKED_MESSAGE } from "../../../core/graphql/errors";
import { useEdgeStore } from "../../../core/graphql/edgeRefusals";
import { useOfflineStore } from "../../offline/state/useOfflineStore";

/** What the reconnect banner says while the server refuses the WebSocket for too many connections. */
export const TOO_MANY_CONNECTIONS_MESSAGE =
  "Too many connections to this server. Close another RIM window or tab; trying again in a while.";

/**
 * The real-time connection's state across the top of the app: lost and reconnecting, refused
 * for too many connections, refused because the address is blocked, or just reconnected.
 */
export function ConnectionBanner() {
  const status = useConnectionStore((s) => s.status);
  const blocked = useEdgeStore((s) => s.blocked);
  const tooManyConnections = useEdgeStore((s) => s.tooManyConnections);
  // While the app runs offline, `OfflineBanner` says so instead.
  const offline = useOfflineStore((s) => s.offline);
  const [showReconnected, setShowReconnected] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = useConnectionStore.subscribe((state, prev) => {
      if (state.status === prev.status) return;
      clearTimeout(timer);
      const back = prev.status === "disconnected" && state.status === "connected";
      setShowReconnected(back);
      if (back) timer = setTimeout(() => setShowReconnected(false), 3000);
    });
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  if (offline) return null;

  if (blocked) {
    return (
      <div
        role="alert"
        className="flex items-center justify-center gap-2 bg-rim-danger/10 px-3 py-1.5 text-xs text-rim-danger"
      >
        <span className="inline-block h-2 w-2 rounded-full bg-rim-danger" />
        {ADDRESS_BLOCKED_MESSAGE}
      </div>
    );
  }

  if (status === "disconnected") {
    return (
      <div
        role="status"
        className="flex items-center justify-center gap-2 bg-rim-warm/10 px-3 py-1.5 text-xs text-rim-warm"
      >
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-rim-warm" />
        {tooManyConnections ? TOO_MANY_CONNECTIONS_MESSAGE : "Connection lost. Reconnecting..."}
      </div>
    );
  }

  if (showReconnected) {
    return (
      <div className="flex items-center justify-center gap-2 bg-rim-success/10 px-3 py-1.5 text-xs text-rim-success">
        <span className="inline-block h-2 w-2 rounded-full bg-rim-success" />
        Reconnected
      </div>
    );
  }

  return null;
}
