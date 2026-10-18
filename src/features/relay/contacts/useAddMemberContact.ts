import { useCallback } from "react";

import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { toast } from "../../../shared/toast";
import { useAddContact } from "../api/useContacts";
import { resolveIdentity } from "./identity";

/**
 * Adds a member of a shared workspace as a contact: their card, fetched and verified, says
 * which relays reach them. Toasts the outcome.
 *
 * @returns `addContact(principalId, name)` and whether an add is under way.
 */
export function useAddMemberContact(): {
  addContact: (principalId: string, name: string) => Promise<void>;
  isPending: boolean;
} {
  const add = useAddContact();
  const { mutateAsync } = add;
  const addContact = useCallback(
    async (principalId: string, name: string) => {
      try {
        const { card } = await resolveIdentity(principalId);
        if (!card || card.relays.length === 0) {
          throw new Error(`${name} has no published card yet`);
        }
        await mutateAsync({ principalId, relayUrls: card.relays });
        toast.success(`Added ${name} to your contacts`);
      } catch (err) {
        toast.error(graphqlErrorMessage(err, `Could not add ${name} as a contact`));
      }
    },
    [mutateAsync],
  );
  return { addContact, isPending: add.isPending };
}
