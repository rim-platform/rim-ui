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
 *
 * Props:
 * - `token` — raw invite token from the URL param.
 * - `tokenType` — discriminator returned by the preview query.
 * - `workspaceName` — shown in the header when `tokenType === "WORKSPACE"`.
 * - `workspaceId`, `invitedBy`, `ownerName` — the rest of the invite's preview.
 *
 * A workspace invite also says when the account already belongs to another workspace of the
 * same name, with that one's owner, so the two can be told apart.
 *
 * A workspace invite to a workspace the account is already in says so and opens it; a revoked,
 * expired or unknown invite shows the dead-link page; other refusals are one sentence.
 */

import { useNavigate } from "react-router-dom";

import {
  CONFLICT,
  errorSentence,
  EXPIRED_TOKEN,
  FORBIDDEN,
  graphqlErrorCode,
  graphqlErrorMessage,
  INVALID_TOKEN,
  NOT_FOUND,
} from "../../../core/graphql/errors";
import { Button } from "../../../shared/ui/Button";
import { useJoinServerByInviteMutation } from "../../settings/api/useInviteMutations";
import { useMyServers } from "../../workspaces/api/useMyServers";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { BANNED_MESSAGE } from "../../workspaces/publicJoinLink";
import { ownerName as shownOwnerName, sameWorkspaceName } from "../../workspaces/workspaceLabel";
import { InviteTokenType } from "../types";
import { InviteByline } from "./InviteByline";
import { BrandHeading } from "./BrandHeading";
import { InvalidTokenState } from "./InvalidTokenState";

interface JoinAuthenticatedProps {
  /** Raw invite token from the `:token` URL param. */
  token: string;
  /** Token type returned by the preview query. */
  tokenType: InviteTokenType;
  /** Workspace name shown in the header (workspace tokens only). */
  workspaceName?: string;
  /** The invite's workspace (workspace tokens only). */
  workspaceId?: string;
  /** Who sent the invite (workspace tokens only). */
  invitedBy?: string;
  /** The invite's workspace owner; null when it has none. */
  ownerName?: string | null;
}

/** One muted line naming another workspace of this account that shares the invite's name. */
function SameNameNotice({ name, workspaceId }: { name: string; workspaceId?: string }) {
  const { data: servers } = useMyServers();
  const twin = servers?.find(
    (server) => server.id !== workspaceId && sameWorkspaceName(server.name, name),
  );
  if (!twin) return null;
  const owner = shownOwnerName(twin.owner);
  return (
    <p className="text-xs text-rim-text-faint">
      You already belong to a workspace named {twin.name.trim()}
      {owner ? `, owned by ${owner}` : ""}.
    </p>
  );
}

/**
 * Branch rendered when an already-authenticated user visits `/join/:token`.
 *
 * Workspace tokens: shows a confirmation button to accept the invite.
 * Instance tokens: shows an error — existing users cannot use them since they
 * are only for new account creation.
 *
 * The per-token-type rendering is implemented as an exhaustive `switch` over
 * `tokenType` with a `never`-typed default arm. This mirrors the
 * `inviteTokenTypeToJoinFormVariant` helper in `JoinPage.tsx`: if a new
 * `InviteTokenType` enum member is added server-side and pulled through
 * codegen, this component will fail to type-check until the new case is
 * mapped explicitly, rather than any new variant falling into the workspace
 * auto-join arm. The default arm uses a `never`-typed binding so the failure
 * is observable at compile time, not via a thrown error in production.
 */
export function JoinAuthenticated({
  token,
  tokenType,
  workspaceName,
  workspaceId,
  invitedBy,
  ownerName,
}: JoinAuthenticatedProps) {
  const navigate = useNavigate();
  const joinServer = useJoinServerByInviteMutation();
  const setWorkspaceId = useWorkspaceStore((s) => s.setWorkspaceId);
  const { data: servers } = useMyServers();
  const member = workspaceId !== undefined && (servers?.some((s) => s.id === workspaceId) ?? false);
  const code = graphqlErrorCode(joinServer.error);
  const banned = code === FORBIDDEN && graphqlErrorMessage(joinServer.error, "").includes("banned");
  const dead =
    code === NOT_FOUND ||
    code === INVALID_TOKEN ||
    code === EXPIRED_TOKEN ||
    (code === FORBIDDEN && !banned);

  function open() {
    if (workspaceId !== undefined) setWorkspaceId(workspaceId);
    navigate("/");
  }

  function handleJoin() {
    joinServer.mutate(token, {
      onSuccess: (data) => {
        setWorkspaceId(data.joinServerByInvite.serverId);
        navigate("/");
      },
    });
  }

  switch (tokenType) {
    case InviteTokenType.INSTANCE:
      return (
        <div className="flex min-h-screen items-center justify-center bg-rim-void p-4">
          <div className="w-full max-w-lg text-center space-y-2">
            <p className="text-sm text-rim-danger">
              You already have a RIM account; instance invites are only for new users.
            </p>
            <Button type="button" onClick={() => navigate("/")}>
              Go to RIM
            </Button>
          </div>
        </div>
      );
    case InviteTokenType.WORKSPACE:
      if (dead) return <InvalidTokenState code="INVALID_TOKEN" />;
      return (
        <div className="flex min-h-screen items-center justify-center bg-rim-void p-4">
          <div className="w-full max-w-lg space-y-6">
            <header className="text-center">
              <BrandHeading />
              <p className="mt-1 text-sm text-rim-text-muted">
                {workspaceName
                  ? `You have been invited to join ${workspaceName}`
                  : "You have been invited to join a workspace"}
              </p>
              <InviteByline invitedBy={invitedBy} ownerName={ownerName} />
            </header>

            <div className="rounded-xl border border-rim-line bg-rim-panel p-6">
              {member || code === CONFLICT ? (
                <div className="space-y-4">
                  <p className="text-sm text-rim-text-muted">
                    You&apos;re already a member of {workspaceName ?? "this workspace"}.
                  </p>
                  {workspaceName && (
                    <SameNameNotice name={workspaceName} workspaceId={workspaceId} />
                  )}
                  <Button type="button" className="w-full" onClick={open}>
                    {workspaceName ? `Open ${workspaceName}` : "Open workspace"}
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-rim-text-muted">
                    Click below to accept the invitation and join the workspace.
                  </p>
                  {workspaceName && (
                    <SameNameNotice name={workspaceName} workspaceId={workspaceId} />
                  )}
                  {joinServer.error && (
                    <p className="rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger">
                      {banned
                        ? BANNED_MESSAGE
                        : errorSentence(joinServer.error, "Could not join the workspace.")}
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
              )}
            </div>
          </div>
        </div>
      );
    default: {
      const _exhaustive: never = tokenType;
      throw new Error(`Unhandled InviteTokenType: ${String(_exhaustive)}`);
    }
  }
}
