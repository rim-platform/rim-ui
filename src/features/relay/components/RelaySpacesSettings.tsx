import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { Button } from "../../../shared/ui/Button";
import { fetchRemoteSubscriptions } from "../api/relayApi";
import { refusalText } from "../remote/delegations";
import { delegationRecords, renewWorkspaceDelegations } from "../remote/remoteWorkspaces";
import { useRelayStore } from "../state/useRelayStore";

function when(value: string | number | null | undefined): string {
  return value === null || value === undefined ? "not set" : new Date(value).toLocaleString();
}

/**
 * Settings > Security > "Spaces through this relay": the workspaces on other servers this
 * relay carries for the person, the host's status for each, when this device's delegation for
 * it runs out, why the host refused its last renewal, and a way to renew them now.
 */
export function RelaySpacesSettings() {
  const qc = useQueryClient();
  const relayOn = useRelayStore((s) => s.account !== null);
  const spaces = useRelayStore((s) => s.spaces);
  const origins = useRelayStore((s) => s.origins);
  const refusals = useRelayStore((s) => s.refusals);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const subscriptions = useQuery({
    queryKey: ["remoteSubscriptions"],
    queryFn: fetchRemoteSubscriptions,
    enabled: relayOn,
    retry: false,
  });
  const delegations = useQuery({
    queryKey: ["delegationRecords"],
    queryFn: delegationRecords,
    enabled: relayOn,
  });
  if (!relayOn) return null;

  async function renew() {
    setBusy(true);
    setError(null);
    try {
      await renewWorkspaceDelegations(true);
    } catch (err) {
      setError(graphqlErrorMessage(err, "Could not renew the delegations."));
    } finally {
      await qc.invalidateQueries({ queryKey: ["remoteSubscriptions"] });
      await qc.invalidateQueries({ queryKey: ["delegationRecords"] });
      setBusy(false);
    }
  }

  const rows = subscriptions.data ?? [];
  return (
    <section className="space-y-2 rounded-lg border border-rim-line bg-rim-panel p-4">
      <p className="text-sm font-medium text-rim-text">Spaces through this relay</p>
      <p className="text-xs text-rim-text-muted">
        Workspaces on other servers reach you through this server. This device lets it carry each
        one for a day at a time and renews that while the app runs.
      </p>
      {subscriptions.error ? (
        <p className="text-xs text-rim-text-muted">This server cannot list them.</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-rim-text-muted">
          {subscriptions.isPending ? "Loading..." : "None yet."}
        </p>
      ) : (
        <ul className="divide-y divide-rim-line">
          {rows.map((row) => {
            const space = spaces[row.workspaceId];
            const mine = delegations.data?.find((d) => d.workspaceId === row.workspaceId);
            return (
              <li key={`${row.hostServerId}:${row.workspaceId}`} className="py-2">
                <p className="text-sm text-rim-text">
                  {space?.name ?? row.workspaceId}
                  <span className="ml-2 text-xs text-rim-text-faint">
                    on {origins[row.hostServerId] ?? row.hostServerId}
                  </span>
                </p>
                <p className="text-xs text-rim-text-muted">
                  {row.status === "active" ? "Active" : `Not active: ${row.status}`} · until{" "}
                  {when(row.expiresAt)} · this device&apos;s delegation until{" "}
                  {when(mine?.expiresAt)}
                </p>
                {row.workspaceId in refusals && (
                  <p className="text-xs text-rim-warm">
                    {refusalText(refusals[row.workspaceId] ?? null)}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Button variant="secondary" size="sm" isLoading={busy} onClick={() => void renew()}>
        Renew now
      </Button>
      {error && (
        <p role="alert" className="text-xs text-rim-danger">
          {error}
        </p>
      )}
    </section>
  );
}
