const DEFAULT_GRAPHQL_ENDPOINT = "http://localhost:8080/api";

/** Where the desktop app keeps the relay it moved to; not a secret. */
const RELAY_ENDPOINT_KEY = "rim.relayEndpoint";

function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** The relay the desktop app moved to, if it switched relays. */
function movedEndpoint(): string | null {
  if (!isDesktop()) return null;
  try {
    return window.localStorage.getItem(RELAY_ENDPOINT_KEY);
  } catch {
    return null;
  }
}

/**
 * Point the desktop app at another relay's GraphQL endpoint from its next start (`null`
 * goes back to the configured one). The web app is served by its relay and never moves.
 */
export function setRelayEndpoint(endpoint: string | null): void {
  if (!isDesktop()) return;
  try {
    if (endpoint) window.localStorage.setItem(RELAY_ENDPOINT_KEY, endpoint);
    else window.localStorage.removeItem(RELAY_ENDPOINT_KEY);
  } catch {
    // Without storage the app stays on its configured relay.
  }
}

/** Whether the desktop app runs against a relay it moved to rather than the configured one. */
export function usesMovedRelay(): boolean {
  return movedEndpoint() !== null;
}

/** The GraphQL HTTP endpoint: the relay the desktop moved to, else env or the localhost default. */
export function getGraphqlEndpoint(): string {
  return movedEndpoint() ?? (import.meta.env.VITE_GRAPHQL_ENDPOINT || DEFAULT_GRAPHQL_ENDPOINT);
}

/** The host of a GraphQL endpoint, or the endpoint itself when it does not parse. */
export function endpointHost(endpoint: string): string {
  try {
    return new URL(endpoint, window.location.origin).host;
  } catch {
    return endpoint;
  }
}

/**
 * API origin with the trailing `/api` mount path stripped, e.g.
 * `http://localhost:8080` (or `https://api.example.com/rim` if `/api` is
 * mounted under a sub-path). Use to build REST/file paths like
 * `${getApiOrigin()}/api/files/upload`.
 *
 * Normalizes and validates the configured endpoint once, here — resolves
 * relative endpoints (e.g. `/api`) against `window.location` so the result
 * is always an absolute origin, and if the endpoint doesn't end in `/api`
 * (a misconfigured `VITE_GRAPHQL_ENDPOINT`, e.g. a bare origin or some other
 * path), falls back to just the origin rather than concatenating onto
 * whatever path happens to be configured, which would produce
 * malformed REST/WS URLs (extra or missing path segments). `getWsEndpoint`
 * builds on this so both derivations share one normalization path.
 */
export function getApiOrigin(): string {
  const endpoint = getGraphqlEndpoint();
  let url: URL;
  try {
    url = new URL(endpoint, window.location.origin);
  } catch {
    // Malformed endpoint string that even a same-origin base can't parse:
    // fall back to naive suffix-stripping rather than throw; the result may
    // be wrong.
    return endpoint.replace(/\/api$/, "");
  }
  if (url.pathname.endsWith("/api")) {
    return url.origin + url.pathname.slice(0, -"/api".length);
  }
  return url.origin;
}

/**
 * The base URL of the RIM web app, for links that leave the app such as invite links. The web
 * app returns the page's own origin, where it is served. The desktop app returns
 * {@link getApiOrigin}, the server it talks to: a deployment serves the web app there or sends
 * those paths on to the domain that serves it, and the server builds its own emailed links on
 * that base.
 */
export function getWebBaseUrl(): string {
  return isDesktop() ? getApiOrigin() : window.location.origin;
}

/**
 * The graphql-ws endpoint (`ws(s)://…/api/ws`), derived from {@link getApiOrigin}
 * so the WS and REST/GraphQL endpoints always agree on the API origin.
 */
export function getWsEndpoint(): string {
  const origin = getApiOrigin();
  const wsOrigin = origin.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
  return `${wsOrigin}/api/ws`;
}
