import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react";
import { ShieldAlert } from "lucide-react";

import { toast } from "../../../shared/toast";
import { Button } from "../../../shared/ui/Button";
import { Dialog } from "../../../shared/ui/Dialog";
import {
  OUTSIDE_AGENT_ARM_MS,
  typedWordFor,
} from "../../agent/components/ConfirmCommandModal/confirmGuards";
import { verbMatches } from "../../agent/components/ConfirmCommandModal/verbDeriver";
import {
  useConfirmationModalStore,
  type ConfirmationRequest,
} from "../../agent/state/confirmationModalStore";
import { showInvisibleCharacters } from "../runtime/invisibleCharacters";
import type { PendingView } from "../runtime/pairing";
import { useAgentApprovalWarningStore } from "../state/useAgentApprovalWarningStore";
import { usePendingPairingStore } from "../state/usePendingPairingStore";

/** How long Approve ignores activation after the warning opens. */
const APPROVAL_ARM_MS = 600;

/** What the warning says when what it was about stopped waiting. */
const NO_LONGER_WAITING = "The request is no longer waiting";

const ACTS_AS_YOU = "It will act as you. Only approve if you asked it to.";

interface AgentApprovalWarningDialogProps {
  title: string;
  confirmLabel: string;
  /** How long Approve stays disabled after the dialog opens. */
  armMs: number;
  /** A word to type before Approve is enabled, or `null`. */
  typedWord: string | null;
  /** What the agent asked for. */
  children: ReactNode;
  onApprove: () => void;
  onCancel: () => void;
}

/**
 * The danger dialog shown before a command approves an agent's request or connection. Focus
 * starts on Cancel, Approve stays disabled for `armMs` so a held or repeated key cannot confirm
 * it, and Escape cancels the warning without reaching the dialog beneath it.
 */
export function AgentApprovalWarningDialog({
  title,
  confirmLabel,
  armMs,
  typedWord,
  children,
  onApprove,
  onCancel,
}: AgentApprovalWarningDialogProps) {
  const [armed, setArmed] = useState(false);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setArmed(true), armMs);
    return () => clearTimeout(timer);
  }, [armMs]);

  // Taken before every other listener, so the request or pairing dialog beneath does not answer
  // Escape by refusing.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onCancel();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  const wordOk = typedWord === null || verbMatches(typed, typedWord);
  const enabled = armed && wordOk;

  return (
    <Dialog open title={title} maxWidth="max-w-md" onClose={onCancel}>
      <div className="space-y-3" data-testid="agent-approval-warning">
        {children}
        <div className="flex items-start gap-2 rounded border border-rim-danger/40 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger">
          <ShieldAlert aria-hidden="true" className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p>{ACTS_AS_YOU}</p>
        </div>
        {typedWord !== null && (
          <label className="block text-xs text-rim-text-muted">
            Type &quot;{typedWord}&quot; to approve
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="mt-1 w-full rounded border border-rim-line bg-rim-void px-3 py-2 font-mono text-sm text-rim-text focus:border-rim-accent focus:outline-none"
            />
          </label>
        )}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" autoFocus onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="danger"
          disabled={!enabled}
          onClick={() => {
            if (enabled) onApprove();
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}

/** Approves the open request through the confirmation dialog's own call, if it is still open. */
function approveRequest(token: string): void {
  useAgentApprovalWarningStore.getState().close();
  const { request, approve } = useConfirmationModalStore.getState();
  if (request?.token !== token) {
    toast.info(NO_LONGER_WAITING);
    return;
  }
  approve();
}

/** Connects the waiting program through the pairing dialog's own call, if it is still waiting. */
function approvePairing(requestId: string): void {
  useAgentApprovalWarningStore.getState().close();
  const { pending, approve } = usePendingPairingStore.getState();
  if (pending?.requestId !== requestId) {
    toast.info(NO_LONGER_WAITING);
    return;
  }
  approve(requestId);
}

/** The warning for an agent's request: who asks, and what for, as the confirmation shows it. */
function RequestWarning({
  request,
  onCancel,
}: {
  request: ConfirmationRequest;
  onCancel: () => void;
}) {
  const outside = request.outsideAgent;
  const name = outside ? showInvisibleCharacters(outside.name) : "the assistant";
  const summary =
    request.description ??
    (request.dangerous ? "This is a dangerous command." : request.nlDescription);
  return (
    <AgentApprovalWarningDialog
      title={`Approve ${name}?`}
      confirmLabel="Approve"
      armMs={outside ? Math.max(APPROVAL_ARM_MS, OUTSIDE_AGENT_ARM_MS) : APPROVAL_ARM_MS}
      typedWord={typedWordFor(request)}
      onApprove={() => approveRequest(request.token)}
      onCancel={onCancel}
    >
      <p className="break-words text-sm text-rim-text">
        {outside ? `${name} asks to:` : "The assistant asks to:"}{" "}
        <span className="font-mono text-rim-warm">{showInvisibleCharacters(request.toolName)}</span>
      </p>
      {summary && <p className="break-words text-sm text-rim-text-muted">{summary}</p>}
      {outside && outside.target.length > 0 && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
          {outside.target.map(({ label, value }) => (
            <Fragment key={label}>
              <dt className="text-rim-text-muted">{label}</dt>
              <dd className="break-words text-rim-text">{showInvisibleCharacters(value)}</dd>
            </Fragment>
          ))}
        </dl>
      )}
      {outside?.text !== undefined && (
        <div
          role="group"
          aria-label="The text to send"
          tabIndex={0}
          className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text"
        >
          {showInvisibleCharacters(outside.text)}
        </div>
      )}
    </AgentApprovalWarningDialog>
  );
}

/** The warning for a program asking to connect, with the code it must show. */
function PairingWarning({ view, onCancel }: { view: PendingView; onCancel: () => void }) {
  const name = showInvisibleCharacters(view.name);
  return (
    <AgentApprovalWarningDialog
      title={`Connect ${name}?`}
      confirmLabel="Connect"
      armMs={APPROVAL_ARM_MS}
      typedWord={null}
      onApprove={() => approvePairing(view.requestId)}
      onCancel={onCancel}
    >
      <p className="break-words text-sm text-rim-text">
        A program on this computer that calls itself “{name}” is asking to connect.
      </p>
      <p className="text-sm text-rim-text">
        Only connect if the agent shows this code:{" "}
        <span className="font-mono">
          {view.code.slice(0, 3)} {view.code.slice(3)}
        </span>
      </p>
    </AgentApprovalWarningDialog>
  );
}

/**
 * Shows the approval warning a command opened, on every screen of the app, while what it is
 * about is still waiting. When the request expires or is answered elsewhere, the warning closes
 * and says so.
 */
export function AgentApprovalWarningHost() {
  const warning = useAgentApprovalWarningStore((s) => s.warning);
  const close = useAgentApprovalWarningStore((s) => s.close);
  const request = useConfirmationModalStore((s) => s.request);
  const pending = usePendingPairingStore((s) => s.pending);

  const waitingRequest =
    warning?.kind === "request" && request?.token === warning.token && request.initiator !== "user"
      ? request
      : null;
  const waitingPairing =
    warning?.kind === "pairing" && pending?.requestId === warning.requestId ? pending : null;
  const gone = warning !== null && waitingRequest === null && waitingPairing === null;

  useEffect(() => {
    if (!gone) return;
    close();
    toast.info(NO_LONGER_WAITING);
  }, [gone, close]);

  const cancel = useCallback(() => close(), [close]);

  if (waitingRequest) {
    return <RequestWarning key={waitingRequest.token} request={waitingRequest} onCancel={cancel} />;
  }
  if (waitingPairing) {
    return (
      <PairingWarning key={waitingPairing.requestId} view={waitingPairing} onCancel={cancel} />
    );
  }
  return null;
}
