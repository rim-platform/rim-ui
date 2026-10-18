import { UserPlus } from "lucide-react";

import { useContacts } from "../api/useContacts";
import { useAddMemberContact } from "../contacts/useAddMemberContact";
import { useRelayStore } from "../state/useRelayStore";

/**
 * "Add as contact" for a member of a shared workspace. Shown only while the relay is on, for
 * someone with a principal id who is not a contact yet.
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
  const { addContact, isPending } = useAddMemberContact();
  if (!principalId || !me || principalId === me || !contacts.data) return null;
  if (contacts.data.some((c) => c.principalId === principalId)) return null;

  return (
    <button
      type="button"
      title="Add as contact"
      aria-label={`Add ${name} as contact`}
      disabled={isPending}
      onClick={() => void addContact(principalId, name)}
      className="rounded p-1 text-rim-text-faint opacity-0 transition hover:text-rim-text group-hover:opacity-100 focus:opacity-100"
    >
      <UserPlus className="h-3.5 w-3.5" />
    </button>
  );
}
