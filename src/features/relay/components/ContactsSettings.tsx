import { useCallback, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

import { getApiOrigin } from "../../../core/graphql/config";
import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { Button } from "../../../shared/ui/Button";
import {
  useAddContact,
  useContacts,
  useRemoveContact,
  useVerifiedIdentity,
} from "../api/useContacts";
import type { ContactView } from "../api/relayApi";
import { formatContactLink, parseContactLink, type ContactLink } from "../contacts/contactLink";
import { canScanCodes } from "../contacts/qrScanner";
import { useContactStore } from "../contacts/useContactStore";
import { useRelayStore } from "../state/useRelayStore";
import { PrincipalFingerprint } from "./PrincipalFingerprint";
import { ScanContactCode } from "./ScanContactCode";

const inputClass =
  "w-full rounded-md border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none placeholder:text-rim-text-faint focus:border-rim-accent/40";

/**
 * Settings > Contacts: this account's contact link and QR code, adding people from theirs,
 * and the contact list with the names given to them here. Everything shown about a contact
 * comes from their verified card.
 */
export function ContactsSettings() {
  const principalId = useRelayStore((s) => s.account?.principalId ?? null);
  const relayOn = useRelayStore((s) => s.info !== null);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-rim-text">Contacts</h2>
        <p className="mt-1 text-sm text-rim-text-muted">
          People you can message on any RIM server. Share your link, or add someone from theirs.
        </p>
      </div>
      {!relayOn || !principalId ? (
        <p className="text-sm text-rim-text-muted">
          Contacts need key sign-in (Settings &gt; Security) and a server that relays messages.
        </p>
      ) : (
        <>
          <OwnContactLink principalId={principalId} />
          <AddContact me={principalId} />
          <ContactList />
        </>
      )}
    </div>
  );
}

function OwnContactLink({ principalId }: { principalId: string }) {
  const [copied, setCopied] = useState(false);
  const link = formatContactLink({ principalId, relayUrl: getApiOrigin() });
  return (
    <section className="space-y-3 rounded-lg border border-rim-line bg-rim-panel p-4">
      <p className="text-sm font-medium text-rim-text">Your contact link</p>
      <div className="flex flex-wrap items-start gap-4">
        <div className="rounded-md bg-white p-2">
          <QRCodeSVG value={link} level="M" size={148} aria-label="Contact QR code" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <code className="block select-all break-all font-mono text-xs text-rim-text">{link}</code>
          <p className="text-xs text-rim-text-muted">
            Fingerprint: <PrincipalFingerprint principalId={principalId} />
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              void navigator.clipboard
                ?.writeText(link)
                .then(() => setCopied(true))
                .catch(() => setCopied(false))
            }
          >
            {copied ? "Copied" : "Copy link"}
          </Button>
        </div>
      </div>
    </section>
  );
}

/** Adding someone from their contact link or QR code; the viewer's own link is refused. */
function AddContact({ me }: { me: string }) {
  const [text, setText] = useState("");
  const [scanning, setScanning] = useState(false);
  const [link, setLink] = useState<ContactLink | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const read = useCallback(
    (value: string) => {
      setText(value);
      setScanning(false);
      try {
        const parsed = parseContactLink(value);
        if (parsed.principalId === me) {
          setLink(null);
          setProblem("this is your own contact link");
          return;
        }
        setLink(parsed);
        setProblem(null);
      } catch (err) {
        setLink(null);
        setProblem(err instanceof Error ? err.message : "this is not a RIM contact link");
      }
    },
    [me],
  );

  return (
    <section className="space-y-2 rounded-lg border border-rim-line bg-rim-panel p-4">
      <p className="text-sm font-medium text-rim-text">Add a contact</p>
      <textarea
        className={inputClass}
        rows={2}
        value={text}
        aria-label="Contact link"
        placeholder="rim-contact:1:rimp1_…:https://…"
        onChange={(e) => read(e.target.value)}
      />
      {canScanCodes() &&
        (scanning ? (
          <ScanContactCode onCode={read} onClose={() => setScanning(false)} />
        ) : (
          <Button variant="secondary" size="sm" onClick={() => setScanning(true)}>
            Scan a QR code
          </Button>
        ))}
      {problem && text.trim() && (
        <p role="alert" className="text-xs text-rim-danger">
          {problem}
        </p>
      )}
      {link && (
        <ConfirmContact
          key={link.principalId}
          link={link}
          onDone={() => {
            setText("");
            setLink(null);
          }}
        />
      )}
    </section>
  );
}

/** The verified card behind a link, to confirm before adding. */
function ConfirmContact({ link, onDone }: { link: ContactLink; onDone: () => void }) {
  const identity = useVerifiedIdentity(link.principalId, [link.relayUrl]);
  const add = useAddContact();
  const setAlias = useContactStore((s) => s.setAlias);
  const [alias, setAliasDraft] = useState("");

  if (identity.isPending) return <p className="text-xs text-rim-text-muted">Checking…</p>;
  if (identity.error) {
    return (
      <p role="alert" className="text-xs text-rim-danger">
        {graphqlErrorMessage(identity.error, "Could not verify this person.")}
      </p>
    );
  }
  const card = identity.data.card;
  const relays = [...new Set([...(card?.relays ?? []), link.relayUrl])];
  return (
    <div className="space-y-2 rounded-md border border-rim-line p-3">
      <p className="text-sm text-rim-text">{card?.displayName ?? "No name published"}</p>
      <p className="text-xs text-rim-text-muted">
        Fingerprint: <PrincipalFingerprint principalId={link.principalId} />. Compare it with what
        they see under Settings &gt; Contacts.
      </p>
      <input
        className={inputClass}
        value={alias}
        aria-label="Name for this contact"
        placeholder="Name for this contact (optional)"
        onChange={(e) => setAliasDraft(e.target.value)}
      />
      {add.error && (
        <p role="alert" className="text-xs text-rim-danger">
          {graphqlErrorMessage(add.error, "Could not add the contact.")}
        </p>
      )}
      <Button
        size="sm"
        isLoading={add.isPending}
        onClick={() =>
          add.mutate(
            { principalId: link.principalId, relayUrls: relays },
            {
              onSuccess: () => {
                if (alias.trim()) void setAlias(link.principalId, alias);
                onDone();
              },
            },
          )
        }
      >
        Add contact
      </Button>
    </div>
  );
}

function ContactList() {
  const contacts = useContacts();
  if (contacts.isPending) return <p className="text-sm text-rim-text-muted">Loading contacts…</p>;
  if (contacts.error) {
    return (
      <p role="alert" className="text-sm text-rim-danger">
        {graphqlErrorMessage(contacts.error, "Could not load your contacts.")}
      </p>
    );
  }
  if (contacts.data.length === 0) {
    return <p className="text-sm text-rim-text-muted">No contacts yet.</p>;
  }
  return (
    <ul className="divide-y divide-rim-line rounded-lg border border-rim-line bg-rim-panel">
      {contacts.data.map((contact) => (
        <ContactRow key={contact.principalId} contact={contact} />
      ))}
    </ul>
  );
}

function ContactRow({ contact }: { contact: ContactView }) {
  const identity = useVerifiedIdentity(contact.principalId, contact.relayUrls);
  const alias = useContactStore((s) => s.aliases[contact.principalId]);
  const setAlias = useContactStore((s) => s.setAlias);
  const remove = useRemoveContact();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(alias ?? "");
  const cardName = identity.data?.card?.displayName ?? null;

  return (
    <li className="space-y-1 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm text-rim-text">
            {alias ?? cardName ?? "Unverified contact"}
            {alias && cardName && (
              <span className="ml-2 text-xs text-rim-text-faint">{cardName}</span>
            )}
          </p>
          <p className="text-xs text-rim-text-faint">
            <PrincipalFingerprint principalId={contact.principalId} /> ·{" "}
            {contact.relayUrls.join(", ")}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="ghost" size="sm" onClick={() => setEditing((v) => !v)}>
            Rename
          </Button>
          <Button
            variant="secondary"
            size="sm"
            isLoading={remove.isPending}
            onClick={() => remove.mutate(contact.principalId)}
          >
            Remove
          </Button>
        </div>
      </div>
      {identity.error && (
        <p className="text-xs text-rim-danger">
          Their card could not be verified; their name is not shown.
        </p>
      )}
      {editing && (
        <div className="flex gap-2">
          <input
            className={inputClass}
            value={draft}
            aria-label="Name for this contact"
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button
            size="sm"
            onClick={() => {
              void setAlias(contact.principalId, draft);
              setEditing(false);
            }}
          >
            Save
          </Button>
        </div>
      )}
    </li>
  );
}
