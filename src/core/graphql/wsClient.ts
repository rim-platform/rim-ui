import { createClient } from "graphql-ws";

import { getApiOrigin, getWsEndpoint } from "./config";
import { readEdgeRefusal, useEdgeStore, type EdgeRefusal } from "./edgeRefusals";
import { isSessionEndedClose } from "./subscriptionErrors";

type ConnectionListener = () => void;

/**
 * The WebSocket's state: `idle` while no subscription needs it (it opens on the first one and
 * closes after the last), `connecting` on its first attempt, `connected`, and `disconnected`
 * from a lost connection until it is back.
 */
export type WsStatus = "idle" | "connecting" | "connected" | "disconnected";

const connectionListeners = new Set<ConnectionListener>();
const disconnectionListeners = new Set<ConnectionListener>();
const sessionEndedListeners = new Set<ConnectionListener>();
const statusListeners = new Set<(status: WsStatus) => void>();

let status: WsStatus = "idle";

/** The WebSocket's state now. */
export function wsStatus(): WsStatus {
  return status;
}

/** Register a callback invoked with every change of {@link wsStatus}. */
export function onWsStatus(listener: (status: WsStatus) => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

function setStatus(next: WsStatus) {
  if (status === next) return;
  status = next;
  statusListeners.forEach((fn) => fn(next));
}

/** The close graphql-ws makes once the last subscription has ended. */
const NORMAL_CLOSURE = 1000;

/** Register a callback invoked every time the WebSocket (re)connects. */
export function onWsConnected(listener: ConnectionListener): () => void {
  connectionListeners.add(listener);
  return () => {
    connectionListeners.delete(listener);
  };
}

/** Register a callback invoked every time the WebSocket disconnects. */
export function onWsDisconnected(listener: ConnectionListener): () => void {
  disconnectionListeners.add(listener);
  return () => {
    disconnectionListeners.delete(listener);
  };
}

/**
 * Register a callback invoked when the server closes the WebSocket because the session ended.
 * Nothing reconnects after that close; the app has to sign in again.
 */
export function onWsSessionEnded(listener: ConnectionListener): () => void {
  sessionEndedListeners.add(listener);
  return () => {
    sessionEndedListeners.delete(listener);
  };
}

// ---------------------------------------------------------------------------
// Reconnection tuning
// ---------------------------------------------------------------------------

/** Maximum backoff delay between reconnection attempts (ms). */
const MAX_BACKOFF_MS = 10_000;

/** First wait after an upgrade the server refused (too many connections, a blocked address). */
const REFUSED_BACKOFF_MS = 30_000;

/** Longest wait between upgrades the server keeps refusing (ms). */
const MAX_REFUSED_BACKOFF_MS = 300_000;

/**
 * Keepalive ping interval (ms).
 * Detects dead connections (e.g. after laptop sleep, network switch) by
 * pinging the server periodically. If no pong arrives within PONG_TIMEOUT_MS,
 * the connection is forcibly closed so the retry cycle kicks in immediately.
 */
const KEEPALIVE_MS = 15_000;

/** How long to wait for a pong before declaring the connection dead (ms). */
const PONG_TIMEOUT_MS = 5_000;

// Singleton state — tied to the single wsClient instance below.
let activeSocket: WebSocket | null = null;
let pongTimeoutId: ReturnType<typeof setTimeout> | undefined;
/** Whether the socket of the latest attempt opened, so its upgrade was accepted. */
let attemptOpened = false;

/**
 * Why the server refused the WebSocket upgrade, or `null`. A browser hides the status of a
 * failed upgrade, so the same URL is asked over plain HTTP: the server's edge refuses that
 * request as it refused the upgrade (403 `blocked`, 429 `rate_limited` or
 * `too_many_connections`), and anything else is no refusal.
 */
export async function probeUpgradeRefusal(): Promise<EdgeRefusal> {
  try {
    const response = await fetch(`${getApiOrigin()}/api/ws`, {
      credentials: "include",
      cache: "no-store",
    });
    return await readEdgeRefusal(response);
  } catch {
    return null;
  }
}

/**
 * The wait before the next connection attempt after `retries` failed ones: exponential from
 * one second up to ten; from thirty seconds up to five minutes after a refused upgrade; the
 * server's `retryAfterSeconds` after a rate-limited one.
 */
export function reconnectDelayMs(retries: number, refusal: EdgeRefusal): number {
  if (refusal?.kind === "rateLimited" && refusal.retryAfterSeconds !== undefined) {
    return Math.max(1000, refusal.retryAfterSeconds * 1000);
  }
  if (refusal) return Math.min(REFUSED_BACKOFF_MS * 2 ** retries, MAX_REFUSED_BACKOFF_MS);
  return Math.min(1000 * 2 ** retries, MAX_BACKOFF_MS);
}

/**
 * Waits `delay` ms. An `interruptible` wait ends early when the browser regains network
 * connectivity or the tab becomes visible again, so the retry fires without the full backoff.
 */
function pause(delay: number, interruptible: boolean): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;

    function done() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener("online", done);
      document.removeEventListener("visibilitychange", onVisible);
      resolve();
    }

    function onVisible() {
      if (document.visibilityState === "visible") {
        done();
      }
    }

    const timer = setTimeout(done, delay);
    if (!interruptible) return;
    window.addEventListener("online", done);
    document.addEventListener("visibilitychange", onVisible);
  });
}

export const wsClient = createClient({
  // Use a function so the URL is resolved on each connection attempt,
  // allowing it to react to environment or origin changes at reconnect time.
  url: () => getWsEndpoint(),

  // Reconnect automatically — never give up.
  retryAttempts: Infinity,

  // Ping the server every 15 s to detect dead connections quickly.
  keepAlive: KEEPALIVE_MS,

  // A failed upgrade is retried too; the probe below tells a refusal from an outage. A close
  // for an ended session is not: the session is gone, and only signing in again helps.
  shouldRetry: (event) => !isSessionEndedClose(event),

  retryWait: async (retries) => {
    // An attempt whose socket never opened was refused or could not reach the server; a
    // refusal waits longer, and is not cut short by the network or the tab coming back.
    const refusal = attemptOpened ? null : await probeUpgradeRefusal();
    useEdgeStore.getState().setTooManyConnections(refusal?.kind === "tooManyConnections");
    await pause(reconnectDelayMs(retries, refusal), refusal === null);
  },

  on: {
    connecting: () => {
      attemptOpened = false;
      // Attempts after a lost connection stay `disconnected` until one connects.
      if (status === "idle") setStatus("connecting");
    },
    opened: () => {
      attemptOpened = true;
    },
    connected: (socket) => {
      activeSocket = socket as WebSocket;
      useEdgeStore.getState().setTooManyConnections(false);
      useEdgeStore.getState().setBlocked(false);
      setStatus("connected");
      connectionListeners.forEach((fn) => fn());
    },
    closed: (event) => {
      activeSocket = null;
      clearTimeout(pongTimeoutId);
      // A normal closure while subscriptions remain is reconnected at once (`connecting`).
      const code = (event as { code?: number } | null)?.code;
      setStatus(code === NORMAL_CLOSURE ? "idle" : "disconnected");
      disconnectionListeners.forEach((fn) => fn());
      if (isSessionEndedClose(event)) sessionEndedListeners.forEach((fn) => fn());
    },
    ping: (received) => {
      if (!received) {
        // A ping was just *sent*: start a pong countdown.
        // If the server doesn't respond in time, force-close the socket
        // so the retry loop kicks in with a fresh connection attempt.
        pongTimeoutId = setTimeout(() => {
          if (activeSocket?.readyState === WebSocket.OPEN) {
            activeSocket.close(4408, "Request Timeout");
          }
        }, PONG_TIMEOUT_MS);
      }
    },
    pong: (received) => {
      if (received) {
        // Server responded — connection is alive, cancel the timeout.
        clearTimeout(pongTimeoutId);
      }
    },
  },
});
