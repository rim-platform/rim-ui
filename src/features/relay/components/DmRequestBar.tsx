import { useState } from "react";

import { Button } from "../../../shared/ui/Button";
import { runCommandFromClick } from "../../commands/runtime/runFromClick";
import { useManageCommandStore } from "../../commands/state/useManageCommandStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import type { DmRequestView } from "../api/relayApi";
import { PrincipalFingerprint } from "./PrincipalFingerprint";
import { REPORT_REASONS, useDmRequestActions } from "./useDmRequestActions";

/**
 * In place of the composer of a conversation whose message request the viewer has not decided:
 * who wants to message them, that nothing they write reaches the sender before they accept, and
 * Accept, Ignore, Block, after a confirmation, and Report. Each runs its command on this
 * conversation's request (`people.accept_request`, `people.ignore_request`, `people.block`,
 * `people.report_request` with the reason picked), as the palette does. Ignore and Block leave
 * the conversation's view.
 */
export function DmRequestBar({ request }: { request: DmRequestView }) {
  const { name, senderUnverified } = useDmRequestActions(request, { closeOnDismiss: true });
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  // A decision on this request is running, or waits for its confirmation.
  const busy = useManageCommandStore(
    (s) => s.request?.kind === "request" && s.request.requestId === request.id,
  );
  const [reporting, setReporting] = useState(false);

  const run = (commandId: string, args?: Record<string, unknown>) =>
    runCommandFromClick(
      commandId,
      args,
      workspaceId ? { target: { workspaceId, conversationId: request.conversationId } } : {},
    );

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
          {senderUnverified && " · their card could not be verified"}
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" disabled={busy} onClick={() => void run("people.accept_request")}>
          Accept
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => void run("people.ignore_request")}
        >
          Ignore
        </Button>
        <Button variant="danger" size="sm" disabled={busy} onClick={() => void run("people.block")}>
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
                void run("people.report_request", { reason }).then(
                  (outcome) => outcome.ok && setReporting(false),
                )
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
