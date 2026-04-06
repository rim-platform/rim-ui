import { createClient } from "graphql-ws";

function getWsEndpoint(): string {
  const httpEndpoint = import.meta.env.VITE_GRAPHQL_ENDPOINT || "http://localhost:8080/api";

  // If the endpoint is a relative path (e.g. "/api"), resolve it against the
  // current page origin so the WebSocket constructor receives an absolute URL
  // with the ws(s):// scheme.  Browsers require an absolute URL for WebSocket.
  let absolute: string;
  if (/^https?:\/\//.test(httpEndpoint)) {
    absolute = httpEndpoint;
  } else {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    absolute = `${proto}//${window.location.host}${httpEndpoint}`;
    // Already has the correct ws(s) scheme, just append /ws
    return absolute.replace(/\/api$/, "/api/ws");
  }

  // Convert http(s) to ws(s) and append /ws
  return absolute
    .replace(/^https:/, "wss:")
    .replace(/^http:/, "ws:")
    .replace(/\/api$/, "/api/ws");
}

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

export const wsClient = createClient({
  // Use a function so the URL is resolved on each connection attempt,
  // allowing it to react to environment or origin changes at reconnect time.
  url: () => getWsEndpoint(),
  // Reconnect automatically
  retryAttempts: Infinity,
  retryWait: async (retries) => {
    // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
    const delay = Math.min(1000 * Math.pow(2, retries), 30000);
    await new Promise((resolve) => setTimeout(resolve, delay));
  },
  on: {
    connected: () => {
      connectionListeners.forEach((fn) => fn());
    },
    closed: () => {
      disconnectionListeners.forEach((fn) => fn());
    },
  },
});
