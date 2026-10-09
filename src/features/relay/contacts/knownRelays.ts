/**
 * Where to ask about people this app met outside the contact list: the relays a DM invite's
 * card named for whoever started it. Hints only: whatever is fetched with them is verified
 * against the principal id.
 */

import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import type { ContactView } from "../api/relayApi";

const seen = new Map<string, string[]>();

export function rememberRelays(principalId: string, relayUrls: readonly string[]): void {
  if (relayUrls.length === 0) return;
  seen.set(principalId, [...new Set([...relayUrls, ...(seen.get(principalId) ?? [])])]);
}

/** The relays to ask for `principalId`: their contact entry first, then any seen elsewhere. */
export function relayUrlsFor(principalId: string): string[] {
  const contacts = queryClient.getQueryData<ContactView[]>(queryKeys.relayContacts) ?? [];
  const contact = contacts.find((c) => c.principalId === principalId)?.relayUrls ?? [];
  return [...new Set([...contact, ...(seen.get(principalId) ?? [])])];
}
