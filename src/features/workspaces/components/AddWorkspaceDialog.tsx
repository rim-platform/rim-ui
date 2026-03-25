import { useState } from "react";
import { ArrowLeft, Building2, Link } from "lucide-react";

import { Dialog } from "../../../shared/ui/Dialog";
import { Button } from "../../../shared/ui/Button";
import { useCreateServerMutation } from "../api/useCreateServer";
import { useJoinServerMutation } from "../api/useJoinServer";
import { useWorkspaceStore } from "../state/useWorkspaceStore";

type Step = "choose" | "create" | "join";

const stepTitles: Record<Step, string> = {
  choose: "Add workspace",
  create: "Create workspace",
  join: "Join workspace",
};

export function AddWorkspaceDialog({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>("choose");
  const [name, setName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const setWorkspaceId = useWorkspaceStore((s) => s.setWorkspaceId);

  const create = useCreateServerMutation();
  const join = useJoinServerMutation();

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    create.mutate(
      { name: name.trim() },
      {
        onSuccess: (data) => {
          setWorkspaceId(data.createServer.id);
          onClose();
        },
      },
    );
  }

  function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteCode.trim()) return;

    join.mutate(inviteCode.trim(), {
      onSuccess: (data) => {
        setWorkspaceId(data.joinServerByInvite.serverId);
        onClose();
      },
    });
  }

  function goBack() {
    setStep("choose");
    create.reset();
    join.reset();
  }

  function formatError(error: unknown): string {
    if (error instanceof Error) {
      const msg = error.message;
      if (msg.includes("already a member")) return "You are already a member of this workspace.";
      if (msg.includes("PermissionDenied") || msg.includes("permission"))
        return "This invite is expired or revoked.";
      if (msg.includes("not found") || msg.includes("NotFound"))
        return "Invalid invite code.";
      return msg;
    }
    return "Something went wrong.";
  }

  return (
    <Dialog open title={stepTitles[step]} onClose={onClose}>
      {/* Back button for sub-steps — rendered before the Dialog children content */}
      {step !== "choose" && (
        <div className="-mt-3 mb-3">
          <button
            type="button"
            onClick={goBack}
            className="flex items-center gap-1 rounded p-1 text-xs text-rim-text-muted transition hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </button>
        </div>
      )}

      {/* Step 1: Choose */}
      {step === "choose" && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setStep("create")}
            className="w-full rounded-lg border border-rim-line bg-rim-void p-4 text-left transition hover:border-rim-accent/40 hover:bg-rim-void/80"
          >
            <div className="mb-1 flex items-center gap-2 text-sm font-medium text-white">
              <Building2 className="h-4 w-4 text-rim-text-muted" />
              Create New
            </div>
            <div className="text-xs text-rim-text-muted">Start your own workspace</div>
          </button>

          <button
            type="button"
            onClick={() => setStep("join")}
            className="w-full rounded-lg border border-rim-line bg-rim-void p-4 text-left transition hover:border-rim-accent/40 hover:bg-rim-void/80"
          >
            <div className="mb-1 flex items-center gap-2 text-sm font-medium text-white">
              <Link className="h-4 w-4 text-rim-text-muted" />
              Join Existing
            </div>
            <div className="text-xs text-rim-text-muted">Enter an invite code</div>
          </button>
        </div>
      )}

      {/* Step 2a: Create */}
      {step === "create" && (
        <form onSubmit={handleCreate} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-rim-text-faint">
              Name
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              placeholder="My Workspace"
              autoFocus
              className="w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-rim-text-faint focus:border-rim-accent/40"
            />
          </label>

          {create.error && (
            <p className="rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-sm text-red-200">
              {formatError(create.error)}
            </p>
          )}

          <Button
            type="submit"
            variant="primary"
            disabled={!name.trim()}
            isLoading={create.isPending}
            className="w-full"
          >
            {create.isPending ? "Creating..." : "Create"}
          </Button>
        </form>
      )}

      {/* Step 2b: Join */}
      {step === "join" && (
        <form onSubmit={handleJoin} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-rim-text-faint">
              Invite code
            </span>
            <input
              type="text"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.currentTarget.value)}
              placeholder="rim_inv_..."
              autoFocus
              className="w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-rim-text-faint focus:border-rim-accent/40"
            />
          </label>

          {join.error && (
            <p className="rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-sm text-red-200">
              {formatError(join.error)}
            </p>
          )}

          <Button
            type="submit"
            variant="primary"
            disabled={!inviteCode.trim()}
            isLoading={join.isPending}
            className="w-full"
          >
            {join.isPending ? "Joining..." : "Join"}
          </Button>
        </form>
      )}
    </Dialog>
  );
}
