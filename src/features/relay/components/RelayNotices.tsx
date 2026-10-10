import { AlertTriangle, PlugZap, ShieldAlert } from "lucide-react";

import { Button } from "../../../shared/ui/Button";
import { Dialog } from "../../../shared/ui/Dialog";
import { activeDirect, useDirectStore } from "../direct/directConnection";
import { directTransport } from "../direct/directTransport";
import { relayProcessor } from "../runtime/relayRuntime";
import { useRelayStore, type MissingNotice } from "../state/useRelayStore";

/** Why the web app does not offer a direct connection. */
export const WEB_DIRECT_REASON =
  "Connecting directly needs the desktop app: a browser cannot stay signed in to another server.";

/** A space as people know it: the direct messages a relay homes, or its server's address. */
function spaceLabel(notice: MissingNotice, origin: string | undefined): string {
  const where = origin ?? notice.hostServerId;
  const space = useRelayStore.getState().spaces[notice.spaceId];
  if (space?.kind === "direct") return `direct messages on ${where}`;
  return space?.name ? `${space.name} on ${where}` : where;
}

/** The question asked once per host before the app connects to it directly. */
function DirectOffer() {
  const offer = useDirectStore((s) => s.offer);
  const origin = useRelayStore((s) => (offer ? (s.origins[offer] ?? offer) : null));
  if (!offer || !origin) return null;
  const answer = (yes: boolean) => void activeDirect()?.answer(offer, yes ? "yes" : "no");
  return (
    <Dialog open title="Connect directly?" onClose={() => answer(false)}>
      <div className="space-y-4">
        <p className="text-sm text-rim-text">
          Your relay is not getting messages through. Connect directly to {origin}? It will see your
          IP address.
        </p>
        <p className="text-xs text-rim-text-muted">
          RIM remembers your answer for this server and goes back to the relay once it answers
          again.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => answer(false)}>
            Not now
          </Button>
          <Button size="sm" onClick={() => answer(true)}>
            Connect directly
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * What the relay could not keep right: a server whose identity changed in a way RIM cannot
 * verify (the app stopped using it), spaces whose messages may be missing after a gap could
 * not be reconciled, and the hosts the desktop app is connected to directly meanwhile.
 */
export function RelayNotices() {
  const forked = useRelayStore((s) => s.forked);
  const missing = useRelayStore((s) => s.missing);
  const origins = useRelayStore((s) => s.origins);
  const connected = useDirectStore((s) => s.connected);
  const connecting = useDirectStore((s) => s.connecting);
  const errors = useDirectStore((s) => s.errors);
  const offer = useDirectStore((s) => s.offer);
  const canConnect = directTransport().sessions;
  const notices = Object.values(missing).filter((n) => !(n.hostServerId in connected));
  const direct = Object.keys(connected);
  const failed = Object.entries(errors);
  if (
    forked.length === 0 &&
    notices.length === 0 &&
    direct.length === 0 &&
    failed.length === 0 &&
    !offer
  ) {
    return null;
  }
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
      {direct.map((host) => (
        <div
          key={host}
          role="status"
          className="flex items-center gap-2 bg-rim-accent/10 px-3 py-1.5 text-xs text-rim-accent"
        >
          <PlugZap className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">
            Connected directly to {origins[host] ?? host}. It can see your IP address; RIM goes back
            to your relay once it answers again.
          </span>
        </div>
      ))}
      {failed.map(([host, error]) => (
        <div
          key={`error:${host}`}
          role="alert"
          className="flex items-center gap-2 bg-rim-danger/10 px-3 py-1.5 text-xs text-rim-danger"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>
            Could not connect directly to {origins[host] ?? host}: {error}
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
            {!canConnect && <span className="ml-1 text-rim-text-faint">{WEB_DIRECT_REASON}</span>}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void relayProcessor()?.reconcileSpace(notice.spaceId)}
          >
            Try again
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!canConnect || connecting.includes(notice.hostServerId)}
            title={canConnect ? undefined : WEB_DIRECT_REASON}
            onClick={() => activeDirect()?.ask(notice.hostServerId)}
          >
            {connecting.includes(notice.hostServerId) ? "Connecting..." : "Connect directly"}
          </Button>
        </div>
      ))}
      <DirectOffer />
    </div>
  );
}
