import { UserPlus } from "lucide-react";

import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { toast } from "../../../shared/toast";
import { useAddContact, useContacts } from "../api/useContacts";
import { resolveIdentity } from "../contacts/identity";
import { useRelayStore } from "../state/useRelayStore";

/**
 * "Add as contact" for a member of a shared workspace: their card, fetched and verified, says
 * which relays reach them. Shown only while the relay is on, for someone with a principal id
 * who is not a contact yet.
 */
export function AddContactButton({
  principalId,
  name,
}: {
  principalId?: string | null;
  name: string;
}) {
  const me = useRelayStore((s) => s.account?.principalId ?? null);
  const contacts = useContacts();
  const add = useAddContact();
  if (!principalId || !me || principalId === me || !contacts.data) return null;
  if (contacts.data.some((c) => c.principalId === principalId)) return null;

  async function addThem(id: string) {
    try {
      const { card } = await resolveIdentity(id);
      if (!card || card.relays.length === 0) throw new Error(`${name} has no published card yet`);
      await add.mutateAsync({ principalId: id, relayUrls: card.relays });
      toast.success(`Added ${name} to your contacts`);
    } catch (err) {
      toast.error(graphqlErrorMessage(err, `Could not add ${name} as a contact`));
    }
  }

  return (
    <button
      type="button"
      title="Add as contact"
      aria-label={`Add ${name} as contact`}
      disabled={add.isPending}
      onClick={() => void addThem(principalId)}
      className="rounded p-1 text-rim-text-faint opacity-0 transition hover:text-rim-text group-hover:opacity-100 focus:opacity-100"
    >
      <UserPlus className="h-3.5 w-3.5" />
    </button>
  );
}
