import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Dialog } from "../../../shared/ui/Dialog";
import { signOut } from "../runtime/signOut";

interface SignOutDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Asks how to sign out: keep the account on this device for the next sign-in, or remove from
 * this device everything it left here.
 */
export function SignOutDialog({ open, onClose }: SignOutDialogProps) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<"keep" | "remove" | null>(null);

  async function handleSignOut(remove: boolean) {
    if (pending) return;
    setPending(remove ? "remove" : "keep");
    try {
      await signOut(queryClient, { remove });
    } finally {
      setPending(null);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={pending ? () => undefined : onClose}
      title="Sign out"
      maxWidth="max-w-md"
    >
      <div className="space-y-2 text-sm text-rim-text-muted mb-4">
        <p>
          Signing out keeps this account on this device: its keys, cached messages and settings stay
          here for the next sign-in.
        </p>
        <p>
          Removing it deletes them from this device. If this device holds the only copy of your
          identity key, you need your recovery kit to use the account again.
        </p>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={pending !== null}
          className="rounded-lg border border-rim-line px-4 py-2 text-sm text-rim-text transition hover:bg-white/5 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void handleSignOut(false)}
          disabled={pending !== null}
          className="rounded-lg border border-rim-line bg-rim-void px-4 py-2 text-sm font-medium text-rim-text transition hover:bg-white/5 disabled:opacity-50"
        >
          {pending === "keep" ? "Signing out..." : "Sign out"}
        </button>
        <button
          type="button"
          onClick={() => void handleSignOut(true)}
          disabled={pending !== null}
          className="rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-4 py-2 text-sm font-medium text-rim-danger transition hover:bg-rim-danger/20 disabled:opacity-50"
        >
          {pending === "remove" ? "Removing..." : "Sign out and remove from this device"}
        </button>
      </div>
    </Dialog>
  );
}
