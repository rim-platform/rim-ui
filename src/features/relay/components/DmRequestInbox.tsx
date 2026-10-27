import { useState } from "react";

import { Button } from "../../../shared/ui/Button";
import type { DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import { useContextMenu } from "../../../shared/ui/contextMenu/useContextMenu";
import type { DmRequestView } from "../api/relayApi";
import { usePendingDmRequestsIn } from "../api/useDmRequests";
import { BlockConfirmDialog } from "./BlockConfirmDialog";
import { PrincipalFingerprint } from "./PrincipalFingerprint";
import { REPORT_REASONS, useDmRequestActions } from "./useDmRequestActions";

interface DmRequestInboxProps {
  /**
   * The requests shown: those of one workspace's conversations, with `null` those from
   * outside every workspace; all of them when left out.
   */
  workspaceId?: string | null;
}

/**
 * Message requests: DMs the person's settings take as requests, held by the relay until they
 * decide. Each shows the name from the sender's verified card and the fingerprint of their
 * principal id; the person may read the conversation first, then accept, ignore, block, after a
 * confirmation, or report. Requests a shared workspace lets through are accepted on their own.
 */
export function DmRequestInbox({ workspaceId }: DmRequestInboxProps) {
  const requests = usePendingDmRequestsIn(workspaceId);
  if (requests.length === 0) return null;
  return (
    <section className="mb-2 rounded-lg border border-rim-line" aria-label="Message requests">
      <h3 className="border-b border-rim-line px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-rim-text-faint">
        Message requests ({requests.length})
      </h3>
      <ul className="divide-y divide-rim-line">
        {requests.map((request) => (
          <DmRequestRow key={request.id} request={request} />
        ))}
      </ul>
    </section>
  );
}

function DmRequestRow({ request }: { request: DmRequestView }) {
  const actions = useDmRequestActions(request);
  const { name, busy } = actions;
  const [reporting, setReporting] = useState(false);
  const contextMenu = useContextMenu();

  function report(reason: string) {
    void actions.report(reason).then((done) => done && setReporting(false));
  }

  // The row's buttons, as a context menu; nothing opens while one of them runs.
  const menuItems = (): DropdownMenuItem[] =>
    busy
      ? []
      : [
          { id: "accept", label: "Accept", onSelect: () => void actions.accept() },
          { id: "read-first", label: "Read first", onSelect: () => void actions.readFirst() },
          { id: "ignore", label: "Ignore", onSelect: () => void actions.ignore() },
          {
            id: "report",
            label: "Report",
            submenu: REPORT_REASONS.map((reason) => ({
              id: `report-${reason.toLowerCase()}`,
              label: reason,
              onSelect: () => report(reason),
            })),
          },
          {
            id: "block",
            label: "Block",
            danger: true,
            separatorBefore: true,
            onSelect: actions.askBlock,
          },
        ];

  return (
    <>
      <li
        {...contextMenu.bind(menuItems, { label: `Message request from ${name}` })}
        className="space-y-2 px-3 py-2"
      >
        <div>
          <p className="text-sm text-rim-text">{name}</p>
          <p className="text-xs text-rim-text-faint">
            <PrincipalFingerprint principalId={request.fromPrincipalId} />
            {actions.senderUnverified && " · their card could not be verified"}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" disabled={busy} onClick={() => void actions.accept()}>
            Accept
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => void actions.readFirst()}
          >
            Read first
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => void actions.ignore()}
          >
            Ignore
          </Button>
          <Button variant="danger" size="sm" disabled={busy} onClick={actions.askBlock}>
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
                onClick={() => report(reason)}
              >
                {reason}
              </Button>
            ))}
          </div>
        )}
      </li>
      {contextMenu.menu}
      {actions.confirmingBlock && (
        <BlockConfirmDialog
          name={actions.blockName}
          onConfirm={() => void actions.block()}
          onClose={actions.cancelBlock}
        />
      )}
    </>
  );
}
