import { useState } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";

import { getApiOrigin } from "../../../core/graphql/config";
import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { Button } from "../../../shared/ui/Button";
import { relayProblem } from "../../relay/contacts/contactLink";
import { profileCardRelays, publishProfileCard, type MyKeyIdentity } from "../api/keyIdentity";

const inputClass =
  "w-full rounded-md border border-rim-line bg-rim-void px-3 py-1.5 text-sm text-rim-text outline-none placeholder:text-rim-text-faint focus:border-rim-accent/40";

/**
 * The relays the profile card lists, preferred first: where people on other servers reach
 * this account. This server stays on the list; the card is signed and published again when
 * the list changes.
 */
export function CardRelays({
  identity,
  displayName,
  onPublished,
}: {
  identity: MyKeyIdentity;
  displayName: string;
  onPublished: () => void;
}) {
  const published = profileCardRelays(identity);
  const [relays, setRelays] = useState<string[]>(published);
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const here = getApiOrigin();
  const changed = JSON.stringify(relays) !== JSON.stringify(published);

  function move(index: number, by: -1 | 1) {
    setRelays((list) => {
      const next = [...list];
      const [item] = next.splice(index, 1);
      next.splice(index + by, 0, item);
      return next;
    });
  }

  function add() {
    const url = draft.trim().replace(/\/+$/, "");
    const why = relayProblem(url, relays);
    setProblem(why);
    if (why) return;
    setRelays((list) => [...list, url]);
    setDraft("");
  }

  async function publish() {
    setBusy(true);
    setProblem(null);
    try {
      await publishProfileCard(identity, displayName, relays);
      onPublished();
    } catch (err) {
      setProblem(graphqlErrorMessage(err, "Could not publish the profile card."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2" aria-label="Relays">
      <p className="text-xs text-rim-text-muted">
        Relays: where people on other servers reach you, preferred first. Your card lists them.
      </p>
      <ul className="space-y-1">
        {relays.map((relay, i) => (
          <li key={relay} className="flex items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-rim-text">
              {relay}
              {relay === here && <span className="ml-2 text-rim-accent">this server</span>}
            </span>
            <button
              type="button"
              aria-label={`Move ${relay} up`}
              disabled={i === 0}
              onClick={() => move(i, -1)}
              className="rounded p-1 text-rim-text-faint hover:text-rim-text disabled:opacity-30"
            >
              <ArrowUp className="h-3 w-3" />
            </button>
            <button
              type="button"
              aria-label={`Move ${relay} down`}
              disabled={i === relays.length - 1}
              onClick={() => move(i, 1)}
              className="rounded p-1 text-rim-text-faint hover:text-rim-text disabled:opacity-30"
            >
              <ArrowDown className="h-3 w-3" />
            </button>
            <button
              type="button"
              aria-label={`Remove ${relay}`}
              disabled={relay === here}
              onClick={() => setRelays((list) => list.filter((r) => r !== relay))}
              className="rounded p-1 text-rim-text-faint hover:text-rim-danger disabled:opacity-30"
            >
              <X className="h-3 w-3" />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input
          className={inputClass}
          value={draft}
          placeholder="https://relay.example"
          aria-label="Relay address"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        <Button variant="secondary" size="sm" onClick={add} disabled={!draft.trim()}>
          Add
        </Button>
      </div>
      {problem && (
        <p role="alert" className="text-xs text-rim-danger">
          {problem}
        </p>
      )}
      {changed && (
        <div className="flex gap-2">
          <Button size="sm" isLoading={busy} onClick={() => void publish()}>
            Publish card
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => setRelays(published)}
          >
            Undo
          </Button>
        </div>
      )}
    </div>
  );
}
