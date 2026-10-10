/**
 * One-off calls to a host directly, outside a direct connection: the discovery document is
 * fetched directly and checked against the pin before anything is sent.
 */

import type { Statement } from "../../key-identity/browser/statements";
import { APPLY_REMOTE_REVOCATION_MUTATION } from "../api/documents";
import { pinDiscovery, storedPin } from "../state/serverPins";
import { directRequest } from "./directGraphql";
import { directTransport } from "./directTransport";

/** Check `host` against its pin from its own discovery document and open a direct session. */
export async function openDirectly(host: string): Promise<void> {
  const pinned = await storedPin(host);
  if (!pinned) throw new Error("RIM has not pinned this server");
  const transport = directTransport();
  const document = await transport.discovery(pinned.origin);
  const pin = await pinDiscovery(document, pinned.origin, host);
  await transport.open(host, {
    graphql: pin.endpoints?.graphql ?? `${pin.origin}/api`,
    websocket: pin.endpoints?.websocket ?? `${pin.origin.replace(/^http/, "ws")}/api/ws`,
  });
}

/** Send a device revocation to `host` directly; its signed acknowledgement, unchecked. */
export async function applyRevocationDirectly(
  host: string,
  revocation: Statement,
): Promise<Statement> {
  await openDirectly(host);
  const answer = await directRequest<{ applyRemoteRevocation: Statement }>(
    host,
    APPLY_REMOTE_REVOCATION_MUTATION,
    { revocation: { payload: revocation.payload, signature: revocation.signature } },
  );
  return answer.applyRemoteRevocation;
}
