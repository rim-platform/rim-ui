/**
 * `JoinAuthenticated` — the already-logged-in branch of the `/join/:token`
 * route.
 *
 * Shown when the user has a valid session and clicks an invite link. The
 * behavior differs by token type:
 *
 * - `WORKSPACE` token: offers a "Join workspace" button that calls
 *   `joinServerByInvite` and navigates to `/` after success.
 * - `INSTANCE` token: renders an error message explaining that instance
 *   invites are only for new users. An authenticated user does not need a
 *   second account.
 * - `BOOTSTRAP` token: same error message as INSTANCE — bootstrap tokens are
 *   for first-time account creation and cannot be used by an existing session.
 *
 * Props:
 * - `token` — raw invite token from the URL param.
 * - `tokenType` — discriminator returned by the preview query.
 * - `workspaceName` — shown in the header when `tokenType === "WORKSPACE"`.
 */

import { useNavigate } from "react-router-dom";

import { useJoinServerByInviteMutation } from "../../settings/api/useInviteMutations";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { InviteTokenType } from "../types";

interface JoinAuthenticatedProps {
  /** Raw invite token from the `:token` URL param. */
  token: string;
  /** Token type returned by the preview query. */
  tokenType: InviteTokenType;
  /** Workspace name shown in the header (workspace tokens only). */
  workspaceName?: string;
}

/**
 * Branch rendered when an already-authenticated user visits `/join/:token`.
 *
 * Workspace tokens: shows a confirmation button to accept the invite.
 * Instance and bootstrap tokens: shows an error — existing users cannot use
 * these token types since they are only for new account creation.
 */
export function JoinAuthenticated({
  token,
  tokenType,
  workspaceName,
}: JoinAuthenticatedProps) {
  const navigate = useNavigate();
  const joinServer = useJoinServerByInviteMutation();
  const setWorkspaceId = useWorkspaceStore((s) => s.setWorkspaceId);

  if (tokenType === InviteTokenType.INSTANCE || tokenType === InviteTokenType.BOOTSTRAP) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-rim-void p-4">
        <div className="w-full max-w-lg text-center space-y-2">
          <p className="text-sm text-rim-danger">
            You already have a RIM account; instance invites are only for new users.
          </p>
        </div>
      </div>
    );
  }

  function handleJoin() {
    joinServer.mutate(token, {
      onSuccess: (data) => {
        setWorkspaceId(data.joinServerByInvite.serverId);
        navigate("/");
      },
    });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-rim-void p-4">
      <div className="w-full max-w-lg space-y-6">
        <header className="text-center">
          <h1 className="text-2xl font-semibold text-rim-text">RIM</h1>
          <p className="mt-1 text-sm text-rim-text-muted">
            {workspaceName
              ? `You have been invited to join ${workspaceName}`
              : "You have been invited to join a workspace"}
          </p>
        </header>

        <div className="rounded-xl border border-rim-line bg-rim-panel p-6">
          <div className="space-y-4">
            <p className="text-sm text-rim-text-muted">
              Click below to accept the invitation and join the workspace.
            </p>
            {joinServer.error && (
              <p className="rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger">
                {joinServer.error instanceof Error
                  ? joinServer.error.message
                  : "Failed to join workspace"}
              </p>
            )}
            <button
              type="button"
              onClick={handleJoin}
              disabled={joinServer.isPending}
              className="w-full rounded-lg bg-rim-accent px-4 py-2.5 text-sm font-medium text-rim-void transition hover:bg-rim-accent-strong disabled:opacity-50"
            >
              {joinServer.isPending ? "Joining..." : "Join workspace"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
