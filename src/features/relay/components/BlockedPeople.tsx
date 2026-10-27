import { useId } from "react";

import { asSentence, graphqlErrorMessage, isSchemaRefusal } from "../../../core/graphql/errors";
import { toast } from "../../../shared/toast";
import { Button } from "../../../shared/ui/Button";
import { shortPrincipal } from "../../plugins/registry/model";
import type { BlockedPrincipalView } from "../api/relayApi";
import { useBlockedPrincipals, useUnblockPrincipal } from "../api/useBlockedPrincipals";
import { useRelayStore } from "../state/useRelayStore";

/** How the list names a blocked person: display name, username, or a short principal id. */
function blockedName(entry: BlockedPrincipalView): string {
  return entry.displayName || entry.username || shortPrincipal(entry.principalId);
}

/**
 * Settings → Direct messages → Blocked people: the people this account blocked, newest first,
 * each with when and an Unblock that lifts the block at once. Nothing while the relay is off.
 */
export function BlockedPeople() {
  const headingId = useId();
  const relayOn = useRelayStore((s) => s.info !== null);
  const blocked = useBlockedPrincipals();
  const unblock = useUnblockPrincipal();

  if (!relayOn) return null;

  function unblockEntry(entry: BlockedPrincipalView, name: string) {
    unblock.mutate(entry.principalId, {
      onSuccess: () => toast.success(asSentence(`Unblocked ${name}`)),
      onError: (err) => toast.error(graphqlErrorMessage(err, `Could not unblock ${name}`)),
    });
  }

  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h3 id={headingId} className="text-sm font-semibold text-rim-text">
        Blocked people
      </h3>
      {blocked.isPending && <p className="text-sm text-rim-text-muted">Loading…</p>}
      {blocked.isError && (
        <p role="alert" className="text-sm text-rim-danger">
          {isSchemaRefusal(blocked.error)
            ? "Your server does not list blocked people yet."
            : graphqlErrorMessage(blocked.error, "Could not load the people you blocked.")}
        </p>
      )}
      {blocked.data && blocked.data.length === 0 && (
        <p className="text-sm text-rim-text-muted">You haven't blocked anyone.</p>
      )}
      {blocked.data && blocked.data.length > 0 && (
        <ul className="divide-y divide-rim-line rounded-lg border border-rim-line bg-rim-panel">
          {blocked.data.map((entry) => {
            const name = blockedName(entry);
            const date = new Date(entry.blockedAt).toLocaleDateString([], {
              year: "numeric",
              month: "short",
              day: "numeric",
            });
            return (
              <li
                key={entry.principalId}
                className="flex items-center justify-between gap-4 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-rim-text">{name}</p>
                  <p className="text-xs text-rim-text-faint">Blocked {date}</p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={`Unblock ${name}`}
                  disabled={unblock.isPending}
                  isLoading={unblock.isPending && unblock.variables === entry.principalId}
                  onClick={() => unblockEntry(entry, name)}
                >
                  Unblock
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
