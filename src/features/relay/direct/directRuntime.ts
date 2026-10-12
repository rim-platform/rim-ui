/**
 * Direct connections wired to the app: the trigger check every 15 seconds, the relay probe
 * every 60 seconds while connected, the host's events through `graphql-ws` over a socket the
 * Tauri side opens with the host's session cookie, and the person's remembered answers.
 */

import { createClient } from "graphql-ws";

import type { WorkspaceEvent } from "../../../core/events/types";
import { reportSubscriptionLimit } from "../../../core/graphql/subscriptionErrors";
import { onWsConnected, onWsDisconnected } from "../../../core/graphql/wsClient";
import { logger } from "../../../core/logger";
import { fetchRelayInfo } from "../api/relayApi";
import { WORKSPACE_EVENTS_SUBSCRIPTION } from "../api/documents";
import { relayCrypto } from "../crypto/relayCrypto";
import { allRecords, putRecord } from "../state/relayDb";
import { pinDiscovery, storedPin } from "../state/serverPins";
import { remoteHosts } from "../state/spaces";
import { useRelayStore, type RelayAccount } from "../state/useRelayStore";
import { activeProcessor } from "../stream/activeProcessor";
import { failingFor } from "../transport/relayHealth";
import { renewWorkspaceDelegations } from "../remote/remoteWorkspaces";
import {
  DirectConnections,
  PROBE_MS,
  setActiveDirect,
  useDirectStore,
  type DirectConsent,
} from "./directConnection";
import { DirectSocket } from "./directSocket";
import { directTransport } from "./directTransport";

const CHECK_MS = 15_000;

interface ConsentRecord {
  account: string;
  name: string;
  host: string;
  answer: DirectConsent;
}

function spacesOf(host: string): string[] {
  return Object.values(useRelayStore.getState().spaces)
    .filter((s) => s.hostServerId === host)
    .map((s) => s.spaceId);
}

/** The host's events for `spaceIds` on its own WebSocket. */
function openHostEvents(
  host: string,
  spaceIds: string[],
  onEvent: (event: WorkspaceEvent, spaceId: string) => void,
): () => void {
  const client = createClient({
    url: `rim-direct://${host}`,
    webSocketImpl: DirectSocket,
    retryAttempts: 5,
    keepAlive: 15_000,
  });
  const stops = spaceIds.map((spaceId) =>
    client.subscribe<{ workspaceEvents: string }>(
      { query: WORKSPACE_EVENTS_SUBSCRIPTION, variables: { workspaceId: spaceId } },
      {
        next: (result) => {
          const raw = result.data?.workspaceEvents;
          if (!raw) return;
          try {
            onEvent(JSON.parse(raw) as WorkspaceEvent, spaceId);
          } catch (err) {
            logger.warn("[RIM:relay] a direct event failed:", err);
          }
        },
        error: (err) => {
          if (reportSubscriptionLimit(`[RIM:relay] ${host}'s events`, err)) return;
          logger.warn(`[RIM:relay] ${host}'s events failed:`, err);
        },
        complete: () => undefined,
      },
    ),
  );
  return () => {
    for (const stop of stops) stop();
    void client.dispose();
  };
}

/** Start direct connections for `account`; returns a function that stops them. */
export async function startDirect(
  account: RelayAccount,
  accountKey: string,
  apply: (event: WorkspaceEvent, spaceId: string) => void,
): Promise<() => void> {
  const store = useDirectStore.getState();
  for (const record of await allRecords<ConsentRecord>("meta").catch(() => [])) {
    if (record.account === accountKey && record.name.startsWith("direct:")) {
      store.setConsent(record.host, record.answer);
    }
  }
  const crypto = relayCrypto();
  const connections = new DirectConnections({
    transport: directTransport(),
    principalId: account.principalId,
    loadPin: storedPin,
    pinDiscovery: (document, origin, host) => pinDiscovery(document, origin, host),
    signLogin: (host, challenge) =>
      crypto.signLoginForServer(account.endpoint, host, account.principalId, challenge),
    spacesOf,
    processor: activeProcessor,
    openEvents: openHostEvents,
    apply,
    probeRelay: async () => {
      await fetchRelayInfo();
    },
    renew: async () => {
      await renewWorkspaceDelegations(true);
    },
    saveConsent: (host, answer) =>
      putRecord<ConsentRecord>("meta", {
        account: accountKey,
        name: `direct:${host}`,
        host,
        answer,
      }),
    now: () => Date.now(),
  });
  setActiveDirect(connections);

  let downSince: number | null = null;
  const offDown = onWsDisconnected(() => {
    downSince ??= Date.now();
  });
  const offUp = onWsConnected(() => {
    downSince = null;
  });
  const check = setInterval(() => {
    if (!directTransport().sessions) return;
    const missing = Object.values(useRelayStore.getState().missing).map((m) => m.hostServerId);
    void connections.check({
      hosts: remoteHosts(),
      failingFor: (host) => failingFor(host),
      relayDownFor: downSince === null ? 0 : Date.now() - downSince,
      missing,
    });
  }, CHECK_MS);
  const probe = setInterval(() => void connections.probe(), PROBE_MS);

  return () => {
    clearInterval(check);
    clearInterval(probe);
    offDown();
    offUp();
    connections.closeAll();
    setActiveDirect(null);
    useDirectStore.getState().reset();
  };
}
