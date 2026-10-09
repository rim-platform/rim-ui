import { AlertTriangle, ShieldAlert } from "lucide-react";

import { Button } from "../../../shared/ui/Button";
import { relayProcessor } from "../runtime/relayRuntime";
import { useRelayStore, type MissingNotice } from "../state/useRelayStore";

/** A space as people know it: the direct messages a relay homes, or its server's address. */
function spaceLabel(notice: MissingNotice, origin: string | undefined): string {
  const where = origin ?? notice.hostServerId;
  return useRelayStore.getState().spaces[notice.spaceId]?.kind === "direct"
    ? `direct messages on ${where}`
    : where;
}

/**
 * What the relay could not keep right: a server whose identity changed in a way RIM cannot
 * verify (the app stopped using it), and spaces whose messages may be missing after a gap could
 * not be reconciled. Connecting to a host directly comes later; its button says so.
 */
export function RelayNotices() {
  const forked = useRelayStore((s) => s.forked);
  const missing = useRelayStore((s) => s.missing);
  const origins = useRelayStore((s) => s.origins);
  const notices = Object.values(missing);
  if (forked.length === 0 && notices.length === 0) return null;
  return (
    <div className="space-y-px">
      {forked.map((serverId) => (
        <div
          key={serverId}
          role="alert"
          className="flex items-center gap-2 bg-rim-danger/10 px-3 py-1.5 text-xs text-rim-danger"
        >
          <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
          <span>
            {origins[serverId] ?? serverId}: This server&apos;s identity changed in a way RIM cannot
            verify. RIM stopped using it.
          </span>
        </div>
      ))}
      {notices.map((notice) => (
        <div
          key={notice.spaceId}
          role="status"
          className="flex items-center gap-2 bg-rim-warm/10 px-3 py-1.5 text-xs text-rim-warm"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">
            Messages may be missing from {spaceLabel(notice, origins[notice.hostServerId])}.
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void relayProcessor()?.reconcileSpace(notice.spaceId)}
          >
            Try again
          </Button>
          <Button variant="secondary" size="sm" disabled title="Coming soon">
            Connect directly (soon)
          </Button>
        </div>
      ))}
    </div>
  );
}
