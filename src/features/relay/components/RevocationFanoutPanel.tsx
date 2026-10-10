import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "../../../shared/ui/Button";
import { fetchDeviceRevocationStatus, fetchRemoteSubscriptions } from "../api/relayApi";
import { relayCrypto } from "../crypto/relayCrypto";
import { applyRevocationDirectly } from "../direct/directCalls";
import {
  accessUntil,
  DIRECT_AFTER_MS,
  directDue,
  readFanout,
  sendDirectly,
  unconfirmedText,
  type AckDeps,
  type HostRevocation,
} from "../remote/revocationFanout";
import { useRevocationStore, type FollowedRevocation } from "../remote/useRevocationStore";
import { hostKeyAt } from "../state/serverPins";
import { accountKey } from "../state/spaces";
import { useRelayStore } from "../state/useRelayStore";

const POLL_MS = 5_000;

function ackDeps(): AckDeps {
  return { crypto: relayCrypto(), hostKeyAt };
}

/** What the device can still reach on `host`, as people know it. */
function hostSpaces(host: string): { label: string; workspaceId: string | null }[] {
  const { spaces, origins } = useRelayStore.getState();
  const where = origins[host] ?? host;
  const onHost = Object.values(spaces).filter((s) => s.hostServerId === host);
  if (onHost.length === 0) return [{ label: `your spaces on ${where}`, workspaceId: null }];
  return onHost.map((s) => ({
    label:
      s.kind === "direct" ? `direct messages on ${where}` : (s.name ?? `a workspace on ${where}`),
    workspaceId: s.kind === "workspace" ? s.spaceId : null,
  }));
}

function FollowedFanout({ entry }: { entry: FollowedRevocation }) {
  const origins = useRelayStore((s) => s.origins);
  const [hosts, setHosts] = useState<HostRevocation[] | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const sending = useRef(false);
  const finished = entry.direct !== null;

  const status = useQuery({
    queryKey: ["deviceRevocationStatus", entry.deviceId],
    queryFn: () => fetchDeviceRevocationStatus(entry.deviceId),
    refetchInterval: finished ? false : POLL_MS,
    retry: false,
  });
  const subscriptions = useQuery({
    queryKey: ["remoteSubscriptions"],
    queryFn: fetchRemoteSubscriptions,
    retry: false,
  });

  useEffect(() => {
    if (finished) return;
    const timer = setInterval(() => setNow(Date.now()), POLL_MS);
    return () => clearInterval(timer);
  }, [finished]);

  useEffect(() => {
    if (!status.data) return;
    let stale = false;
    void readFanout(entry.revocation, status.data, ackDeps()).then((read) => {
      if (!stale) setHosts(read);
    });
    return () => {
      stale = true;
    };
  }, [status.data, entry.revocation]);

  // Two minutes in, send the revocation directly to every host without a verified answer.
  useEffect(() => {
    if (finished || !hosts || sending.current || !directDue(entry.revokedAt, now)) return;
    if (hosts.every((h) => h.state === "confirmed")) {
      const account = accountKey();
      if (account) void useRevocationStore.getState().follow(account, { ...entry, direct: hosts });
      return;
    }
    sending.current = true;
    void sendDirectly(entry.revocation, hosts, applyRevocationDirectly, ackDeps()).then(
      (direct) => {
        const account = accountKey();
        if (account) void useRevocationStore.getState().follow(account, { ...entry, direct });
      },
    );
  }, [finished, hosts, now, entry]);

  const shown = entry.direct ?? hosts ?? [];
  const expiryOf = (workspaceId: string | null) =>
    subscriptions.data?.find((s) => s.workspaceId === workspaceId)?.expiresAt ?? null;
  const waitedFor = Math.max(0, Math.ceil((entry.revokedAt + DIRECT_AFTER_MS - now) / 1000));

  return (
    <div className="space-y-2 rounded-md border border-rim-line bg-rim-void p-3">
      <p className="text-sm text-rim-text">Removing the device from other servers</p>
      {status.error && !entry.direct ? (
        <p className="text-xs text-rim-text-muted">
          This server cannot say how the removal reached other servers.
        </p>
      ) : shown.length === 0 ? (
        <p className="text-xs text-rim-text-muted">
          {status.isPending ? "Checking..." : "No other server holds this account."}
        </p>
      ) : (
        <ul className="space-y-1">
          {shown.map((h) => {
            const where = origins[h.host] ?? h.host;
            if (h.state === "confirmed") {
              return (
                <li key={h.host} className="text-xs text-rim-success">
                  {where} confirmed{h.via === "direct" ? " (sent directly)" : ""}.
                </li>
              );
            }
            if (!finished) {
              return (
                <li key={h.host} className="text-xs text-rim-text-muted">
                  {where}: waiting
                  {waitedFor > 0 ? `; sent directly in ${waitedFor} s if it does not answer` : ""}.
                </li>
              );
            }
            return hostSpaces(h.host).map((space) => (
              <li key={`${h.host}:${space.label}`} role="alert" className="text-xs text-rim-warm">
                {unconfirmedText(
                  where,
                  space.label,
                  new Date(
                    accessUntil(entry.revokedAt, expiryOf(space.workspaceId)),
                  ).toLocaleString(),
                )}
                {h.problem ? ` (${h.problem})` : ""}
              </li>
            ));
          })}
        </ul>
      )}
      {finished && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            const account = accountKey();
            if (account) void useRevocationStore.getState().dismiss(account, entry.deviceId);
          }}
        >
          Done
        </Button>
      )}
    </div>
  );
}

/**
 * Settings > Security, under the devices: how each removal reached the other servers that
 * hold this account, which confirmed, and which could not be reached and until when the
 * removed device may keep access there.
 */
export function RevocationFanoutPanel() {
  const relayOn = useRelayStore((s) => s.account !== null);
  const followed = useRevocationStore((s) => s.followed);
  useEffect(() => {
    const account = accountKey();
    if (relayOn && account)
      void useRevocationStore
        .getState()
        .load(account)
        .catch(() => undefined);
  }, [relayOn]);
  if (!relayOn || followed.length === 0) return null;
  return (
    <div className="mt-3 space-y-2">
      {followed.map((entry) => (
        <FollowedFanout key={entry.deviceId} entry={entry} />
      ))}
    </div>
  );
}
