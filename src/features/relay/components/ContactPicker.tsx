import { useCallback, useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";

import { cn } from "../../../shared/ui/cn";
import { useContacts, useVerifiedIdentity } from "../api/useContacts";
import type { ContactView } from "../api/relayApi";
import { useContactStore } from "../contacts/useContactStore";
import { useRelayStore } from "../state/useRelayStore";

export interface PickedContact {
  principalId: string;
  relayUrls: string[];
  name: string;
}

/**
 * Multi-select over the contact list, for a new DM or group in the direct space. Contacts are
 * named by the alias given here or their verified card. The viewer's own principal is never
 * offered: the server refuses a conversation with only yourself.
 */
export function ContactPicker({
  selected,
  onChange,
  onConfirm,
  onEscape,
}: {
  selected: PickedContact[];
  onChange: (picked: PickedContact[]) => void;
  onConfirm: () => void;
  onEscape: () => void;
}) {
  const contacts = useContacts();
  const me = useRelayStore((s) => s.account?.principalId ?? null);
  const [query, setQuery] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});
  const aliases = useContactStore((s) => s.aliases);
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (contacts.data ?? []).filter((c) => {
      if (c.principalId === me) return false;
      const name = aliases[c.principalId] ?? names[c.principalId] ?? "";
      return !needle || name.toLowerCase().includes(needle) || c.principalId.includes(needle);
    });
  }, [contacts.data, me, query, aliases, names]);

  const rememberName = useCallback((principalId: string, name: string) => {
    setNames((n) => (n[principalId] === name ? n : { ...n, [principalId]: name }));
  }, []);

  function toggle(contact: ContactView, name: string) {
    const picked = selected.some((p) => p.principalId === contact.principalId);
    onChange(
      picked
        ? selected.filter((p) => p.principalId !== contact.principalId)
        : [...selected, { principalId: contact.principalId, relayUrls: contact.relayUrls, name }],
    );
  }

  return (
    <div
      className="p-2"
      onKeyDown={(e) => {
        if (e.key === "Escape") onEscape();
        const fromSearch = e.target instanceof HTMLInputElement && !query;
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey || fromSearch) && selected.length > 0) {
          e.preventDefault();
          onConfirm();
        }
      }}
    >
      <input
        autoFocus
        value={query}
        aria-label="Search contacts"
        placeholder="Search contacts..."
        className="w-full bg-transparent px-2 py-2 text-sm text-rim-text outline-none placeholder:text-rim-text-faint"
        onChange={(e) => setQuery(e.target.value)}
      />
      {contacts.isPending ? (
        <p className="px-2 py-3 text-sm text-rim-text-muted">Loading contacts...</p>
      ) : shown.length === 0 ? (
        <p className="px-2 py-3 text-sm text-rim-text-muted">
          No contacts{query ? " match" : " yet"}. Add people in Settings &gt; Contacts.
        </p>
      ) : (
        <ul className="max-h-80 space-y-0.5 overflow-y-auto" aria-label="Contacts">
          {shown.map((contact) => (
            <ContactOption
              key={contact.principalId}
              contact={contact}
              picked={selected.some((p) => p.principalId === contact.principalId)}
              onName={rememberName}
              onToggle={toggle}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ContactOption({
  contact,
  picked,
  onName,
  onToggle,
}: {
  contact: ContactView;
  picked: boolean;
  onName: (principalId: string, name: string) => void;
  onToggle: (contact: ContactView, name: string) => void;
}) {
  const identity = useVerifiedIdentity(contact.principalId, contact.relayUrls);
  const alias = useContactStore((s) => s.aliases[contact.principalId]);
  const cardName = identity.data?.card?.displayName ?? null;
  const name = alias ?? cardName ?? "Unverified contact";
  useEffect(() => {
    if (cardName) onName(contact.principalId, cardName);
  }, [cardName, contact.principalId, onName]);
  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={picked}
        disabled={identity.isError}
        onClick={() => onToggle(contact, name)}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition",
          picked ? "bg-rim-accent/10 text-rim-accent" : "text-rim-text-muted hover:bg-white/5",
          identity.isError && "opacity-50",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {picked && <Check className="h-3.5 w-3.5" />}
      </button>
    </li>
  );
}
