import { CloudOff } from "lucide-react";

import { ADDRESS_BLOCKED_MESSAGE } from "../../../core/graphql/errors";
import { useEdgeStore } from "../../../core/graphql/edgeRefusals";
import { useOfflineStore } from "../state/useOfflineStore";

/**
 * Across the top of the app while it runs offline from what this device saved; says so when
 * the server blocked this address rather than being out of reach.
 */
export function OfflineBanner() {
  const offline = useOfflineStore((s) => s.offline);
  const blocked = useEdgeStore((s) => s.blocked);
  if (!offline) return null;

  return (
    <div
      role="status"
      data-testid="offline-banner"
      className="flex items-center justify-center gap-2 bg-rim-warm/10 px-3 py-1.5 text-xs text-rim-warm"
    >
      <CloudOff className="h-3.5 w-3.5 shrink-0" />
      {blocked
        ? `${ADDRESS_BLOCKED_MESSAGE}. Showing what is saved on this device; sending is off.`
        : "Offline. Showing what is saved on this device; sending is off until the server is back."}
    </div>
  );
}
