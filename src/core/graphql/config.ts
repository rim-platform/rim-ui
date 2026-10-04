const DEFAULT_GRAPHQL_ENDPOINT = "http://localhost:8080/api";

/** The GraphQL HTTP endpoint (env override or the localhost default). */
export function getGraphqlEndpoint(): string {
  return import.meta.env.VITE_GRAPHQL_ENDPOINT || DEFAULT_GRAPHQL_ENDPOINT;
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
 * whatever path happens to be configured — which previously produced
 * malformed REST/WS URLs (extra or missing path segments). `getWsEndpoint`
 * builds on this so both derivations share one normalization path.
 */
export function getApiOrigin(): string {
  const endpoint = getGraphqlEndpoint();
  let url: URL;
  try {
    url = new URL(endpoint, window.location.origin);
  } catch {
    // Malformed endpoint string that even a same-origin base can't parse —
    // fall back to naive suffix-stripping so we don't throw; the result may
    // still be wrong, but no worse than before this function existed.
    return endpoint.replace(/\/api$/, "");
  }
  if (url.pathname.endsWith("/api")) {
    return url.origin + url.pathname.slice(0, -"/api".length);
  }
  return url.origin;
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
