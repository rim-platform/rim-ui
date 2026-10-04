import { useEffect, useRef, useState } from "react";

import { useConnectionStore } from "../state/useConnectionStore";
import { onWsConnected, onWsDisconnected } from "../../../core/graphql/wsClient";

export function ConnectionBanner() {
  const status = useConnectionStore((s) => s.status);
  const setStatus = useConnectionStore((s) => s.setStatus);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hadDisconnectRef = useRef(false);
  const [showReconnected, setShowReconnected] = useState(false);

  useEffect(() => {
    const unsubConnected = onWsConnected(() => {
      if (hadDisconnectRef.current) {
        setStatus("connected");
        setShowReconnected(true);
        dismissTimerRef.current = setTimeout(() => {
          setShowReconnected(false);
        }, 3000);
      } else {
        setStatus("connected");
      }
    });

    const unsubDisconnected = onWsDisconnected(() => {
      hadDisconnectRef.current = true;
      setStatus("disconnected");
      setShowReconnected(false);
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
    });

    return () => {
      unsubConnected();
      unsubDisconnected();
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
      }
    };
  }, [setStatus]);

  if (status === "disconnected") {
    return (
      <div className="flex items-center justify-center gap-2 bg-rim-warm/10 px-3 py-1.5 text-xs text-rim-warm">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-rim-warm" />
        Connection lost. Reconnecting...
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
