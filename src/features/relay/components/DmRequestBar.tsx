import { useState } from "react";

import { Button } from "../../../shared/ui/Button";
import type { DmRequestView } from "../api/relayApi";
import { PrincipalFingerprint } from "./PrincipalFingerprint";
import { REPORT_REASONS, useDmRequestActions } from "./useDmRequestActions";

/**
 * In place of the composer of a conversation whose message request the viewer has not decided:
 * who wants to message them, that nothing they write reaches the sender before they accept, and
 * Accept, Ignore, Block and Report. Ignore and Block leave the conversation's view.
 */
export function DmRequestBar({ request }: { request: DmRequestView }) {
  const actions = useDmRequestActions(request, { closeOnDismiss: true });
  const { name, busy } = actions;
  const [reporting, setReporting] = useState(false);

  return (
    <section
      aria-label={`Message request from ${name}`}
      className="space-y-2 border-t border-rim-line px-4 py-3"
    >
      <div>
        <p className="text-sm text-rim-text">{name} wants to message you.</p>
        <p className="text-xs text-rim-text-muted">
          Accept to reply. Until then they see nothing from you, not even that you read this.
        </p>
        <p className="text-xs text-rim-text-faint">
          <PrincipalFingerprint principalId={request.fromPrincipalId} />
          {actions.senderUnverified && " · their card could not be verified"}
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" disabled={busy} onClick={() => void actions.accept()}>
          Accept
        </Button>
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => void actions.ignore()}>
          Ignore
        </Button>
        <Button variant="danger" size="sm" disabled={busy} onClick={() => void actions.block()}>
          Block
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setReporting((v) => !v)}>
          Report
        </Button>
      </div>
      {reporting && (
        <div className="flex flex-wrap gap-1.5" aria-label="Report reason">
          {REPORT_REASONS.map((reason) => (
            <Button
              key={reason}
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() =>
                void actions.report(reason).then((done) => done && setReporting(false))
              }
            >
              {reason}
            </Button>
          ))}
        </div>
      )}
    </section>
  );
}
