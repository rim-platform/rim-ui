import { useCallback, useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";

import { cn } from "../../../shared/ui/cn";
import { useContacts, useVerifiedIdentity } from "../api/useContacts";
import type { ContactView } from "../api/relayApi";
import { useWorkspacePeople, type WorkspacePerson } from "../api/useWorkspacePeople";
import { useContactStore } from "../contacts/useContactStore";
import { useRelayStore } from "../state/useRelayStore";

export interface PickedContact {
  principalId: string;
  relayUrls: string[];
  name: string;
}

/**
 * Multi-select for a new DM or group in the direct space: the viewer's contacts first, then the
 * people in their workspaces who are not contacts, each person once by principal id. Contacts
 * are named by the alias given here or their verified card, workspace people by their member
 * name. The viewer's own principal is never offered: the server refuses a conversation with
 * only yourself.
 */
export function ContactPicker({
  selected,
  onChange,
  onConfirm,
  onEscape,
  excludePrincipalIds,
}: {
  selected: PickedContact[];
  onChange: (picked: PickedContact[]) => void;
  onConfirm: () => void;
  onEscape: () => void;
  /** People who cannot be picked, such as the conversation's members. */
  excludePrincipalIds?: readonly string[];
}) {
  const contacts = useContacts();
  const workspace = useWorkspacePeople();
  const me = useRelayStore((s) => s.account?.principalId ?? null);
  const [query, setQuery] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});
  const aliases = useContactStore((s) => s.aliases);
  const needle = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      (contacts.data ?? []).filter((c) => {
        if (c.principalId === me || excludePrincipalIds?.includes(c.principalId)) return false;
        const name = aliases[c.principalId] ?? names[c.principalId] ?? "";
        return !needle || name.toLowerCase().includes(needle) || c.principalId.includes(needle);
      }),
    [contacts.data, me, excludePrincipalIds, needle, aliases, names],
  );
  const shownPeople = useMemo(() => {
    const contactIds = new Set((contacts.data ?? []).map((c) => c.principalId));
    return workspace.people.filter(
      (p) =>
        !contactIds.has(p.principalId) &&
        !excludePrincipalIds?.includes(p.principalId) &&
        (!needle ||
          p.name.toLowerCase().includes(needle) ||
          p.username.toLowerCase().includes(needle) ||
          p.principalId.includes(needle)),
    );
  }, [contacts.data, workspace.people, excludePrincipalIds, needle]);

  const rememberName = useCallback((principalId: string, name: string) => {
    setNames((n) => (n[principalId] === name ? n : { ...n, [principalId]: name }));
  }, []);

  function toggle(person: PickedContact) {
    const picked = selected.some((p) => p.principalId === person.principalId);
    onChange(
      picked ? selected.filter((p) => p.principalId !== person.principalId) : [...selected, person],
    );
  }

  const isPicked = (principalId: string) => selected.some((p) => p.principalId === principalId);
  const nobody =
    !contacts.isPending && !workspace.isPending && shown.length === 0 && shownPeople.length === 0;

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
        aria-label="Search people"
        placeholder="Search contacts and workspace members..."
        className="w-full bg-transparent px-2 py-2 text-sm text-rim-text outline-none placeholder:text-rim-text-faint"
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="max-h-80 overflow-y-auto">
        {contacts.isPending ? (
          <p className="px-2 py-3 text-sm text-rim-text-muted">Loading contacts...</p>
        ) : (
          shown.length > 0 && (
            <>
              <GroupLabel>Contacts</GroupLabel>
              <ul className="space-y-0.5" aria-label="Contacts">
                {shown.map((contact) => (
                  <ContactOption
                    key={contact.principalId}
                    contact={contact}
                    picked={isPicked(contact.principalId)}
                    onName={rememberName}
                    onToggle={toggle}
                  />
                ))}
              </ul>
            </>
          )
        )}
        {shownPeople.length > 0 ? (
          <>
            <GroupLabel>People in your workspaces</GroupLabel>
            <ul className="space-y-0.5" aria-label="People in your workspaces">
              {shownPeople.map((person) => (
                <WorkspacePersonOption
                  key={person.principalId}
                  person={person}
                  picked={isPicked(person.principalId)}
                  onToggle={toggle}
                />
              ))}
            </ul>
          </>
        ) : (
          workspace.isPending && (
            <p className="px-2 py-3 text-sm text-rim-text-muted">Loading workspace members...</p>
          )
        )}
        {nobody && (
          <p className="px-2 py-3 text-sm text-rim-text-muted">
            No contacts or workspace members{query ? " match" : " yet"}. Add people in Settings &gt;
            Contacts.
          </p>
        )}
      </div>
    </div>
  );
}

/** The heading of one group of people in the picker. */
function GroupLabel({ children }: { children: string }) {
  return (
    <p className="px-2 pb-1 pt-2 text-[10px] uppercase tracking-wider text-rim-text-faint">
      {children}
    </p>
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
  onToggle: (person: PickedContact) => void;
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
        onClick={() =>
          onToggle({ principalId: contact.principalId, relayUrls: contact.relayUrls, name })
        }
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

/**
 * One person from the viewer's workspaces, picked as a principal with no relay of its own, the
 * way a workspace member is when messaged from their hover card.
 */
function WorkspacePersonOption({
  person,
  picked,
  onToggle,
}: {
  person: WorkspacePerson;
  picked: boolean;
  onToggle: (person: PickedContact) => void;
}) {
  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={picked}
        onClick={() =>
          onToggle({ principalId: person.principalId, relayUrls: [], name: person.name })
        }
        className={cn(
          "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition",
          picked ? "bg-rim-accent/10 text-rim-accent" : "text-rim-text-muted hover:bg-white/5",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{person.name}</span>
        {picked ? (
          <Check className="h-3.5 w-3.5" />
        ) : (
          <span className="max-w-[120px] truncate text-xs text-rim-text-faint">
            {person.username}
          </span>
        )}
      </button>
    </li>
  );
}
