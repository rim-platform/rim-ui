import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "../../../core/query/keys";
import { fetchVerifiedIdentity, type VerifiedIdentity } from "../contacts/identity";
import { useRelayStore } from "../state/useRelayStore";
import { addContact, fetchContacts, removeContact, type ContactView } from "./relayApi";

/** This person's contacts, kept by the relay. Off while the relay is. */
export function useContacts() {
  const relayOn = useRelayStore((s) => s.info !== null);
  return useQuery({
    queryKey: queryKeys.relayContacts,
    enabled: relayOn,
    staleTime: 60_000,
    queryFn: fetchContacts,
  });
}

/** A person's verified identity: key log, devices and card, from their relays. */
export function useVerifiedIdentity(principalId: string | null, relayUrls: readonly string[] = []) {
  return useQuery<VerifiedIdentity>({
    queryKey: queryKeys.remoteIdentity(principalId ?? undefined),
    enabled: Boolean(principalId),
    staleTime: 60 * 60 * 1000,
    retry: false,
    queryFn: () => fetchVerifiedIdentity(principalId!, relayUrls),
  });
}

export function useAddContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ principalId, relayUrls }: Pick<ContactView, "principalId" | "relayUrls">) =>
      addContact(principalId, relayUrls),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.relayContacts }),
  });
}

export function useRemoveContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (principalId: string) => removeContact(principalId),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.relayContacts }),
  });
}
