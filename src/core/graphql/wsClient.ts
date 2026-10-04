import { createClient } from "graphql-ws";

import { getWsEndpoint } from "./config";

type ConnectionListener = () => void;

const connectionListeners = new Set<ConnectionListener>();
const disconnectionListeners = new Set<ConnectionListener>();

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

// ---------------------------------------------------------------------------
// Reconnection tuning
// ---------------------------------------------------------------------------

/** Maximum backoff delay between reconnection attempts (ms). */
const MAX_BACKOFF_MS = 10_000;

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

export const wsClient = createClient({
  // Use a function so the URL is resolved on each connection attempt,
  // allowing it to react to environment or origin changes at reconnect time.
  url: () => getWsEndpoint(),

  // Reconnect automatically — never give up.
  retryAttempts: Infinity,

  // Ping the server every 15 s to detect dead connections quickly.
  keepAlive: KEEPALIVE_MS,

  retryWait: async (retries) => {
    // Exponential backoff: 1 s → 2 s → 4 s → 8 s → cap at 10 s.
    const delay = Math.min(1000 * 2 ** retries, MAX_BACKOFF_MS);

    // The delay is interruptible: if the browser regains network connectivity
    // or the tab becomes visible again we resolve immediately so the retry
    // fires without waiting for the full backoff window.
    await new Promise<void>((resolve) => {
      let settled = false;

      function done() {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        window.removeEventListener("online", done);
        document.removeEventListener("visibilitychange", onVisible);
        resolve();
      }

      const timer = setTimeout(done, delay);

      function onVisible() {
        if (document.visibilityState === "visible") {
          done();
        }
      }

      window.addEventListener("online", done);
      document.addEventListener("visibilitychange", onVisible);
    });
  },

  on: {
    connected: (socket) => {
      activeSocket = socket as WebSocket;
      connectionListeners.forEach((fn) => fn());
    },
    closed: () => {
      activeSocket = null;
      clearTimeout(pongTimeoutId);
      disconnectionListeners.forEach((fn) => fn());
    },
    ping: (received) => {
      if (!received) {
        // We just *sent* a ping — start a pong countdown.
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
