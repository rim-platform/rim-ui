/**
 * A person as their relay serves them (`remoteIdentity`), verified here before anything of it
 * is shown or used: the key log against the principal id and the profile card against the
 * log's head. The relays are asked in order; the first that answers with an identity that
 * verifies wins.
 */

import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { fetchRemoteIdentity, type RemoteIdentityView } from "../api/relayApi";
import { relayCrypto, type CardView } from "../crypto/relayCrypto";

const IDENTITY_STALE_MS = 60 * 60 * 1000;

export interface VerifiedIdentity {
  identity: RemoteIdentityView;
  /** `null` when the person has not published a card. */
  card: CardView | null;
}

export async function fetchVerifiedIdentity(
  principalId: string,
  relayUrls: readonly string[],
): Promise<VerifiedIdentity> {
  const candidates: (string | null)[] = relayUrls.length > 0 ? [...relayUrls] : [null];
  let lastError: unknown = new Error("no relay answered for that person");
  for (const relayUrl of candidates) {
    try {
      const identity = await fetchRemoteIdentity(principalId, relayUrl);
      if (identity.principalId !== principalId)
        throw new Error("the relay answered for someone else");
      const card = identity.card
        ? await relayCrypto().verifyCard(principalId, identity.keyLog, identity.card)
        : null;
      return { identity, card };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

/** `principalId`'s verified identity, from `relayUrls` or (none given) this relay. Cached. */
export function resolveIdentity(
  principalId: string,
  relayUrls: readonly string[] = [],
): Promise<VerifiedIdentity> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.remoteIdentity(principalId),
    queryFn: () => fetchVerifiedIdentity(principalId, relayUrls),
    staleTime: IDENTITY_STALE_MS,
  });
}
