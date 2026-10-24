/**
 * The session secret of a session signed in without "Keep me signed in": 32 bytes as unpadded
 * base64url, held in memory only. Every request to this app's server carries it in
 * `X-RIM-Session-Secret` and the WebSocket in its `connection_init` payload; without it the
 * server treats the request as anonymous, so a session cookie left behind opens nothing.
 */

/** The request header the session secret travels in. */
export const SESSION_SECRET_HEADER = "x-rim-session-secret";

let secret: string | null = null;

/** The session secret, or `null` for a kept session or none. */
export function sessionSecret(): string | null {
  return secret;
}

/**
 * Holds `value` as the session secret, or forgets it with `null`.
 *
 * @param value - The secret as the server returned it, unpadded base64url.
 */
export function setSessionSecret(value: string | null): void {
  secret = value;
}

/** The `X-RIM-Session-Secret` header to add to a request, or no header without a secret. */
export function sessionSecretHeader(): Record<string, string> {
  return secret ? { [SESSION_SECRET_HEADER]: secret } : {};
}
