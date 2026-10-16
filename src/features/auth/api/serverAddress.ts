import { setRelayEndpoint } from "../../../core/graphql/config";

/** A server address read from what someone typed: its GraphQL endpoint, or why it is refused. */
export type ServerAddress = { endpoint: string; host: string } | { error: string };

/** Hosts that may be reached over plain `http://`. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);

export const SERVER_ADDRESS_EMPTY = "Enter the server's address.";
export const SERVER_ADDRESS_INVALID = "That is not a server address.";
export const SERVER_ADDRESS_INSECURE = "Use an https:// address. Only localhost may use http://.";
export const SERVER_ADDRESS_CREDENTIALS = "Leave the user name and password out of the address.";

/**
 * The GraphQL endpoint of the server at `input`: `https://` (assumed when no scheme is given),
 * or `http://` for localhost only; `<origin>/api` unless the address names a path.
 */
export function parseServerAddress(input: string): ServerAddress {
  const trimmed = input.trim();
  if (!trimmed) return { error: SERVER_ADDRESS_EMPTY };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { error: SERVER_ADDRESS_INVALID };
  }
  if (!url.hostname) return { error: SERVER_ADDRESS_INVALID };
  const secure =
    url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname));
  if (!secure) return { error: SERVER_ADDRESS_INSECURE };
  if (url.username || url.password) return { error: SERVER_ADDRESS_CREDENTIALS };

  const path = url.pathname.replace(/\/+$/, "");
  return { endpoint: `${url.origin}${path || "/api"}`, host: url.host };
}

/**
 * Move the desktop app to the server at `endpoint` (`null`: back to the default server) and
 * reload, so every client starts against it.
 */
export function switchServer(
  endpoint: string | null,
  reload: () => void = () => window.location.reload(),
): void {
  setRelayEndpoint(endpoint);
  reload();
}
