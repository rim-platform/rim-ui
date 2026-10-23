import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Building2, Link } from "lucide-react";

import {
  FORBIDDEN,
  graphqlErrorCode,
  graphqlErrorMessage,
  NOT_FOUND,
} from "../../../core/graphql/errors";
import { Dialog } from "../../../shared/ui/Dialog";
import { Button } from "../../../shared/ui/Button";
import { useCreateServerMutation } from "../api/useCreateServer";
import { useJoinServerMutation } from "../api/useJoinServer";
import { useWorkspaceCreationLimit } from "../hooks/useWorkspaceCreationLimit";
import { WorkspaceCreationNote } from "./CreateWorkspaceDialog";
import { useWorkspaceStore } from "../state/useWorkspaceStore";
import { joinWithInvite } from "../../relay/remote/remoteWorkspaces";
import { inviteCodeToken } from "../../auth/inviteCode";
import { toast } from "../../../shared/toast";
import { formatRelativeTime, formatTime } from "../../../shared/utils/formatTime";
import { useMyJoinRequests, useWithdrawJoinRequest } from "../api/publicJoinLink";
import { publicLinkErrorMessage } from "../publicJoinLink";

type Step = "choose" | "create" | "join";

const stepTitles: Record<Step, string> = {
  choose: "Add workspace",
  create: "Create workspace",
  join: "Join workspace",
};

/**
 * Dialog that creates a workspace or joins one with an invite code, and opens the result. The
 * join form takes the bare code, a whole invite link of this server (`https://…/join/<token>`),
 * whose token it joins with, or a `rim-invite:1:…` link to a workspace on another server, which
 * it joins through this server. A workspace's public link (`…/join/rim_pjl_…`) opens its join
 * page, where the person joins or asks to join. The first step also lists the person's open
 * requests to join workspaces under "Waiting for approval", each with Withdraw.
 *
 * @param onClose - Called when the dialog closes, after a workspace was created or joined too.
 * @param initialStep - The step it opens on: the choice between creating and joining (the
 *   default), or straight on the create or join form.
 */
export function AddWorkspaceDialog({
  onClose,
  initialStep = "choose",
}: {
  onClose: () => void;
  initialStep?: Step;
}) {
  const [step, setStep] = useState<Step>(initialStep);
  const [name, setName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const setWorkspaceId = useWorkspaceStore((s) => s.setWorkspaceId);
  const navigate = useNavigate();

  const create = useCreateServerMutation();
  const join = useJoinServerMutation();
  const joinRemote = useMutation({ mutationFn: joinWithInvite });
  const code = inviteCodeToken(inviteCode);
  const remote = code.kind === "remote";
  const joining = remote ? joinRemote : join;
  const creation = useWorkspaceCreationLimit();

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || creation.blocked) return;

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
    if (code.kind === "empty") return;

    if (code.kind === "publicLink") {
      onClose();
      navigate(`/join/${encodeURIComponent(code.token)}`);
      return;
    }

    if (code.kind === "remote") {
      joinRemote.mutate(inviteCode, {
        onSuccess: (joined) => {
          setWorkspaceId(joined.workspaceId);
          onClose();
        },
      });
      return;
    }
    join.mutate(code.token, {
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
    joinRemote.reset();
  }

  function formatError(error: unknown): string {
    const code = graphqlErrorCode(error);
    const msg = graphqlErrorMessage(error, "Something went wrong.");
    if (msg.includes("already a member")) return "You are already a member of this workspace.";
    if (code === NOT_FOUND) return "Invalid invite code.";
    if (code === FORBIDDEN && (msg === "permission denied" || msg.includes("invite")))
      return "This invite is expired or revoked.";
    return msg;
  }

  return (
    <Dialog open title={stepTitles[step]} onClose={onClose}>
      {/* Back button for sub-steps — rendered before the Dialog children content */}
      {step !== "choose" && (
        <div className="-mt-3 mb-3">
          <button
            type="button"
            onClick={goBack}
            className="flex items-center gap-1 rounded p-1 text-xs text-rim-text-muted transition hover:text-rim-text"
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
            <div className="mb-1 flex items-center gap-2 text-sm font-medium text-rim-text">
              <Building2 className="h-4 w-4 text-rim-text-muted" />
              Create New
            </div>
            <div className="text-xs text-rim-text-muted">
              {creation.blocked ?? "Start your own workspace"}
            </div>
          </button>

          <button
            type="button"
            onClick={() => setStep("join")}
            className="w-full rounded-lg border border-rim-line bg-rim-void p-4 text-left transition hover:border-rim-accent/40 hover:bg-rim-void/80"
          >
            <div className="mb-1 flex items-center gap-2 text-sm font-medium text-rim-text">
              <Link className="h-4 w-4 text-rim-text-muted" />
              Join Existing
            </div>
            <div className="text-xs text-rim-text-muted">Enter an invite code or link</div>
          </button>

          <WaitingForApproval />
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
              className="w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2.5 text-sm text-rim-text outline-none transition placeholder:text-rim-text-faint focus:border-rim-accent/40"
            />
          </label>

          <WorkspaceCreationNote {...creation} />

          {create.error && (
            <p className="rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger">
              {formatError(create.error)}
            </p>
          )}

          <Button
            type="submit"
            variant="primary"
            disabled={!name.trim() || Boolean(creation.blocked)}
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
              placeholder="rim_inv_..., an invite link or rim-invite:1:..."
              autoFocus
              className="w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2.5 text-sm text-rim-text outline-none transition placeholder:text-rim-text-faint focus:border-rim-accent/40"
            />
          </label>
          {code.kind === "publicLink" && (
            <p className="text-xs text-rim-text-muted">
              This is a workspace&apos;s public link. Continue opens it, where you can join or ask
              to join.
            </p>
          )}
          {remote && (
            <p className="text-xs text-rim-text-muted">
              This workspace is on another server. RIM checks that server&apos;s identity against
              the invite, and your messages there go through this server.
            </p>
          )}

          {joining.error && (
            <p className="rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger">
              {formatError(joining.error)}
            </p>
          )}

          <Button
            type="submit"
            variant="primary"
            disabled={code.kind === "empty"}
            isLoading={joining.isPending}
            className="w-full"
          >
            {code.kind === "publicLink" ? "Continue" : joining.isPending ? "Joining..." : "Join"}
          </Button>
        </form>
      )}
    </Dialog>
  );
}

/**
 * The signed-in account's open requests to join workspaces, each with its workspace, when it
 * was asked and Withdraw. Renders nothing while there are none or they cannot be read.
 */
function WaitingForApproval() {
  const { data: requests } = useMyJoinRequests();
  const withdraw = useWithdrawJoinRequest();
  if (!requests || requests.length === 0) return null;

  return (
    <section aria-labelledby="waiting-for-approval-heading" className="pt-2">
      <h3
        id="waiting-for-approval-heading"
        className="text-xs font-medium uppercase tracking-wider text-rim-text-faint"
      >
        Waiting for approval
      </h3>
      <ul className="mt-1 divide-y divide-rim-line" aria-label="Your join requests">
        {requests.map((request) => (
          <li
            key={request.id}
            data-testid={`my-join-request-${request.id}`}
            className="flex items-center gap-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-rim-text">{request.workspaceName}</p>
              <p
                className="truncate text-xs text-rim-text-muted"
                title={formatTime(request.createdAt)}
              >
                Asked {formatRelativeTime(request.createdAt)}
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={withdraw.isPending && withdraw.variables === request.id}
              aria-label={`Withdraw your request to join ${request.workspaceName}`}
              onClick={() =>
                withdraw.mutate(request.id, {
                  onSuccess: () =>
                    toast.success(`Withdrew your request to join ${request.workspaceName}`),
                  onError: (err) =>
                    toast.error(publicLinkErrorMessage(err, "Could not withdraw the request")),
                })
              }
            >
              Withdraw
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
