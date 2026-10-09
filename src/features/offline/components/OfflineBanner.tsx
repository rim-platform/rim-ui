import { CloudOff } from "lucide-react";

import { useOfflineStore } from "../state/useOfflineStore";

/** Across the top of the app while it runs offline from what this device saved. */
export function OfflineBanner() {
  const offline = useOfflineStore((s) => s.offline);
  if (!offline) return null;

  return (
    <div
      role="status"
      data-testid="offline-banner"
      className="flex items-center justify-center gap-2 bg-rim-warm/10 px-3 py-1.5 text-xs text-rim-warm"
    >
      <CloudOff className="h-3.5 w-3.5 shrink-0" />
      Offline. Showing what is saved on this device; sending is off until the server is back.
    </div>
  );
}
