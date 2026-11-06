import { useEffect, useState } from "react";

import { Button } from "../../../shared/ui/Button";
import { Dialog } from "../../../shared/ui/Dialog";
import type { PendingView } from "../runtime/pairing";
import { usePendingPairingStore } from "../state/usePendingPairingStore";

function secondsLeft(expiresAt: number): number {
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
}

/** The question a program's request to connect asks the person. */
function AgentPairDialog({
  view,
  onApprove,
  onRefuse,
}: {
  view: PendingView;
  onApprove: () => void;
  onRefuse: () => void;
}) {
  const [left, setLeft] = useState(() => secondsLeft(view.expiresAt));

  useEffect(() => {
    const ticker = setInterval(() => setLeft(secondsLeft(view.expiresAt)), 1000);
    return () => clearInterval(ticker);
  }, [view.expiresAt]);

  return (
    <Dialog open title="Connect this program to RIM?" maxWidth="max-w-md" onClose={onRefuse}>
      <p className="break-words text-sm text-rim-text">
        A program on this computer that calls itself “{view.name}” is asking to connect.
      </p>
      <p className="mt-3 text-sm text-rim-text-muted">Check that it shows this code:</p>
      <p
        role="img"
        aria-label={view.code.split("").join(" ")}
        className="mt-1 font-mono text-2xl text-rim-text"
      >
        {view.code.slice(0, 3)} {view.code.slice(3)}
      </p>
      <p className="mt-3 text-sm text-rim-text-muted">
        It can read nothing until you choose what, and anything it sends or changes waits for you.
        Another program running as you can still do what you can, so connect only programs you
        trust.
      </p>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" autoFocus onClick={onRefuse}>
          Don&apos;t connect
        </Button>
        <Button type="button" onClick={onApprove}>
          The code matches, connect
        </Button>
      </div>
      <p className="mt-3 text-right text-xs text-rim-text-faint">Expires in {left} s</p>
    </Dialog>
  );
}

/** Shows the dialog of the request waiting for the person, on every screen of the app. */
export function AgentPairDialogHost() {
  const view = usePendingPairingStore((s) => s.pending);
  const approve = usePendingPairingStore((s) => s.approve);
  const refuse = usePendingPairingStore((s) => s.refuse);
  if (!view) return null;
  return (
    <AgentPairDialog
      key={view.requestId}
      view={view}
      onApprove={() => approve(view.requestId)}
      onRefuse={() => refuse(view.requestId)}
    />
  );
}
