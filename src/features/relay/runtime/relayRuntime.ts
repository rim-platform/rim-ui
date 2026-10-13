/**
 * The relay for the signed-in account: started once `relayInfo` answers (a server without it
 * runs as before, with the relay off). It learns the account's principal and this device's key,
 * loads the spaces it uses on other servers, routes their requests through the relay (or a
 * direct connection to their host), reads `relayStream` on the existing WebSocket from the last
 * item acknowledged, and keeps the delegations of workspaces elsewhere fresh.
 */

import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";

import { applyWorkspaceEvent } from "../../../core/events/useWorkspaceEvents";
import type { WorkspaceEvent } from "../../../core/events/types";
import { setSpaceRouter } from "../../../core/graphql/client";
import { getGraphqlEndpoint } from "../../../core/graphql/config";
import { onWsConnected, wsClient } from "../../../core/graphql/wsClient";
import {
  isSessionEndedClose,
  reportSubscriptionLimit,
} from "../../../core/graphql/subscriptionErrors";
import { logger } from "../../../core/logger";
import { queryKeys, VOLATILE_WORKSPACE_KEY_ROOTS } from "../../../core/query/keys";
import { toast } from "../../../shared/toast";
import { retryWithBackoff } from "../../../shared/utils/retryWithBackoff";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { keyBackend } from "../../key-identity/api/keyBackend";
import { requestCacheSync } from "../../messages/runtime/messageCacheSync";
import { useOfflineStore } from "../../offline/state/useOfflineStore";
import { ackRelayItems, fetchRelayInfo, fetchRelayMe, fetchStreamHeads } from "../api/relayApi";
import { RELAY_STREAM_SUBSCRIPTION } from "../api/documents";
import { relayCrypto } from "../crypto/relayCrypto";
import { rememberRelays } from "../contacts/knownRelays";
import { useContactStore } from "../contacts/useContactStore";
import { activeDirect } from "../direct/directConnection";
import { startDirect } from "../direct/directRuntime";
import { acceptWorkspaceMembers } from "../inbox/autoAccept";
import { refreshWorkspaceDetails, renewWorkspaceDelegations } from "../remote/remoteWorkspaces";
import { resetRelaySelf } from "../remote/relaySelf";
import { finishOnNewRelay } from "../remote/relaySwitchLive";
import { getRecord, putRecord } from "../state/relayDb";
import { ensurePinned, hostKeyAt, loadPins, resetPinCache } from "../state/serverPins";
import { loadSpaces, registerSpace } from "../state/spaces";
import { hostOf, useRelayStore } from "../state/useRelayStore";
import { activeProcessor, setActiveProcessor } from "../stream/activeProcessor";
import { cardRelays, RelayStreamProcessor } from "../stream/relayStream";
import { loadRelayHealth } from "../transport/relayHealth";
import { sendGraphql } from "../transport/remoteFetch";

const HELD_CHECK_MS = 5_000;
/** How often the delegations of workspaces elsewhere are checked for renewal. */
const RENEW_CHECK_MS = 10 * 60 * 1000;
const CURSOR = "relayCursor";

interface StreamRecord {
  account: string;
  host: string;
  workspaceId: string;
  stream: string;
  last: number;
}

interface CursorRecord {
  account: string;
  name: string;
  after: string;
}

/** The running stream processor, for the request inbox and the "messages missing" retry. */
export function relayProcessor(): RelayStreamProcessor | null {
  return activeProcessor();
}

function renewInBackground(): void {
  void renewWorkspaceDelegations().catch((err: unknown) =>
    logger.warn("[RIM:relay] renewing delegations failed:", err),
  );
}

function streamRecordKey(account: string, key: string): IDBValidKey {
  const [host, workspaceId, stream] = key.split("|");
  return [account, host, workspaceId, stream];
}

/** Refetch what a space shows, after a gap: its lists through host-signed answers, its feed. */
async function refetchSpace(qc: QueryClient, spaceId: string, conversationIds: string[]) {
  for (const root of VOLATILE_WORKSPACE_KEY_ROOTS) {
    await qc.invalidateQueries({ queryKey: [root, spaceId] });
  }
  await qc.invalidateQueries({ queryKey: queryKeys.serverMembers(spaceId) });
  requestCacheSync(spaceId, conversationIds.length > 0 ? conversationIds : undefined);
}

function applyRelayEvent(qc: QueryClient, event: WorkspaceEvent, spaceId: string): void {
  if (event.type === "DmInvite") {
    rememberRelays(event.from_principal_id, cardRelays(event.from_card));
    void qc.invalidateQueries({ queryKey: queryKeys.conversations(spaceId) });
    return;
  }
  applyWorkspaceEvent(event, qc, spaceId);
}

async function start(userId: string, qc: QueryClient): Promise<() => void> {
  const info = await fetchRelayInfo();
  const me = await fetchRelayMe();
  if (me.id !== userId || !me.principalId) {
    logger.debug("[RIM:relay] this account has no principal id; the relay stays off");
    return () => undefined;
  }
  const endpoint = getGraphqlEndpoint();
  const local = (await keyBackend().accounts(endpoint)).find(
    (a) => a.principalId === me.principalId,
  );
  const account = {
    endpoint,
    userId,
    principalId: me.principalId,
    deviceId: local?.deviceId ?? null,
  };
  const key = `${endpoint}|${me.principalId}`;
  const spaces = await loadSpaces(key).catch(() => []);
  useRelayStore.getState().setStarted(info, account, spaces);
  await loadRelayHealth(key).catch(() => undefined);
  await loadPins([...new Set(spaces.map((s) => s.hostServerId))]);
  await useContactStore
    .getState()
    .load()
    .catch(() => undefined);
  setSpaceRouter({
    hostOf,
    send: (host, body) => activeDirect()?.send(host, body) ?? sendGraphql(host, body),
  });

  const active = new RelayStreamProcessor({
    crypto: relayCrypto(),
    principalId: me.principalId,
    hostOf,
    registerSpace: (spaceId, host) => registerSpace(spaceId, host, "direct"),
    ensurePinned: async (host, origins) => {
      await ensurePinned(host, origins);
    },
    hostKeyAt,
    loadLast: async (streamKey) =>
      (await getRecord<StreamRecord>("streams", streamRecordKey(key, streamKey)))?.last ?? null,
    saveLast: async (streamKey, last) => {
      const [host, workspaceId, stream] = streamKey.split("|");
      await putRecord<StreamRecord>("streams", { account: key, host, workspaceId, stream, last });
    },
    streamHeads: fetchStreamHeads,
    refetchSpace: (spaceId, conversations) => refetchSpace(qc, spaceId, conversations),
    apply: (event, spaceId) => applyRelayEvent(qc, event, spaceId),
    ack: async (upTo) => {
      await ackRelayItems(upTo);
      await putRecord<CursorRecord>("meta", { account: key, name: CURSOR, after: upTo });
    },
    onMissing: (spaceId, host) =>
      useRelayStore.getState().setMissing({ spaceId, hostServerId: host, since: Date.now() }),
    onReconciled: (spaceId) => useRelayStore.getState().clearMissing(spaceId),
    onDmRequest: () => {
      void qc.invalidateQueries({ queryKey: ["dmRequests"] });
      void acceptWorkspaceMembers()
        .then((accepted) => {
          if (accepted.length === 0) {
            toast.info("New message request", {
              id: "dm-request",
              description: "Someone you have not talked to yet wants to message you.",
            });
          }
        })
        .catch((err: unknown) => logger.warn("[RIM:relay] checking a request failed:", err));
    },
    onForked: (host) => useRelayStore.getState().markForked(host),
    onRevocationAcked: () => {
      void qc.invalidateQueries({ queryKey: ["deviceRevocationStatus"] });
    },
    now: () => Date.now(),
  });
  setActiveProcessor(active);

  const cursor = await getRecord<CursorRecord>("meta", [key, CURSOR]).catch(() => null);
  const unsubscribe = wsClient.subscribe<{ relayStream: string }>(
    { query: RELAY_STREAM_SUBSCRIPTION, variables: { after: cursor?.after ?? null } },
    {
      next: (result) => {
        if (result.data?.relayStream) void active.push(result.data.relayStream);
      },
      error: (err) => {
        if (reportSubscriptionLimit("[RIM:relay] relayStream", err)) return;
        // The session ended: the app signs out, nothing to report here.
        if (isSessionEndedClose(err)) return;
        logger.warn("[RIM:relay] relayStream failed:", err);
      },
      complete: () => logger.debug("[RIM:relay] relayStream completed"),
    },
  );
  const timer = setInterval(() => void active.checkHeld(), HELD_CHECK_MS);
  void acceptWorkspaceMembers().catch(() => undefined);

  for (const space of spaces) {
    if (space.kind === "workspace" && (!space.name || space.ownerName === undefined)) {
      void refreshWorkspaceDetails(space.spaceId);
    }
  }
  renewInBackground();
  void finishOnNewRelay(me.principalId).catch((err: unknown) =>
    logger.warn("[RIM:relay] finishing a relay switch failed:", err),
  );
  const renewTimer = setInterval(renewInBackground, RENEW_CHECK_MS);
  // Back after the socket was down: delegations may have lapsed meanwhile.
  const offReconnect = onWsConnected(renewInBackground);
  const stopDirect = await startDirect(account, key, (event, spaceId) =>
    applyRelayEvent(qc, event, spaceId),
  );

  return () => {
    unsubscribe();
    clearInterval(timer);
    clearInterval(renewTimer);
    offReconnect();
    stopDirect();
    if (activeProcessor() === active) setActiveProcessor(null);
  };
}

/**
 * Run the relay for the signed-in account. Until it has started, a failed start is tried again
 * on a backoff timer (not while the app is offline), when the app leaves offline mode, and when
 * the WebSocket connects.
 */
export function useRelayRuntime() {
  const userId = useAuthStore((s) => s.session?.userId);
  const qc = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    let stop: (() => void) | null = null;
    const retry = retryWithBackoff(
      async (stopped) => {
        if (useRelayStore.getState().info) return true;
        stop?.();
        stop = null;
        try {
          const stopper = await start(userId, qc);
          if (stopped()) stopper();
          else stop = stopper;
          return true;
        } catch (err) {
          logger.debug("[RIM:relay] the relay is off:", err);
          return false;
        }
      },
      () => !useOfflineStore.getState().offline,
    );
    retry.now();
    const retryIfOff = () => {
      if (!useRelayStore.getState().info) retry.now();
    };
    // A server that came back may run a newer version with the relay on.
    const unsubscribeWs = onWsConnected(retryIfOff);
    const unsubscribeOffline = useOfflineStore.subscribe((state, prev) => {
      if (prev.offline && !state.offline) retryIfOff();
    });
    return () => {
      retry.stop();
      unsubscribeWs();
      unsubscribeOffline();
      stop?.();
      setSpaceRouter(null);
      useRelayStore.getState().reset();
      resetPinCache();
      resetRelaySelf();
    };
  }, [userId, qc]);
}
