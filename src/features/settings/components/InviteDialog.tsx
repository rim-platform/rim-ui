import { useState } from "react";
import { Copy, Check } from "lucide-react";

import { Dialog } from "../../../shared/ui/Dialog";
import { useCreateInviteMutation } from "../api/useInviteMutations";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { toast } from "../../../shared/toast";

interface InviteDialogProps {
  open: boolean;
  onClose: () => void;
}

export function InviteDialog({ open, onClose }: InviteDialogProps) {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const createInvite = useCreateInviteMutation();
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function handleGenerate() {
    if (!workspaceId) return;
    createInvite.mutate(workspaceId, {
      onSuccess: (data) => {
        const link = `${window.location.origin}/join/${data.createInvite.inviteToken}`;
        setInviteLink(link);
        setCopied(false);
      },
    });
  }

  function handleCopy() {
    if (!inviteLink) return;
    navigator.clipboard.writeText(inviteLink).then(() => {
      setCopied(true);
      toast.success("Invite link copied");
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleClose() {
    setInviteLink(null);
    setCopied(false);
    createInvite.reset();
    onClose();
  }

  return (
    <Dialog open={open} onClose={handleClose} title="Invite member">
      <div className="space-y-4">
        {!inviteLink ? (
          <>
            <p className="text-sm text-rim-text-muted">
              Generate a one-time invite link to share with someone you want to add to this workspace.
            </p>
            {createInvite.error && (
              <p className="rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger">
                {createInvite.error instanceof Error ? createInvite.error.message : "Failed to create invite"}
              </p>
            )}
            <button
              type="button"
              onClick={handleGenerate}
              disabled={createInvite.isPending}
              className="w-full rounded-lg bg-rim-accent px-4 py-2.5 text-sm font-medium text-rim-void transition hover:bg-rim-accent-strong disabled:opacity-50"
            >
              {createInvite.isPending ? "Generating..." : "Generate invite link"}
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-rim-text-muted">
              Share this link with the person you want to invite:
            </p>
            <div className="flex items-center gap-2 rounded-lg border border-rim-line bg-rim-void px-3 py-2.5">
              <span className="min-w-0 flex-1 truncate text-sm text-rim-text">{inviteLink}</span>
              <button
                type="button"
                onClick={handleCopy}
                className="shrink-0 rounded p-1 text-rim-text-muted transition hover:text-rim-text"
                aria-label="Copy invite link"
              >
                {copied ? <Check className="h-4 w-4 text-rim-success" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
