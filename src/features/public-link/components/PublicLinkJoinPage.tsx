import { useId, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import { graphqlErrorCode, NOT_FOUND, RATE_LIMITED } from "../../../core/graphql/errors";
import {
  JoinByPublicLinkOutcome,
  PublicJoinLinkMode,
  PublicJoinLinkViewer,
} from "../../../core/graphql/generated/schema-types";
import { Button } from "../../../shared/ui/Button";
import { BrandHeading } from "../../auth/components/BrandHeading";
import { RestoringSession } from "../../auth/components/RestoringSession";
import { useServerConfig } from "../../auth/api/useServerConfig";
import { RegistrationMode } from "../../auth/types";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import {
  JOIN_REQUEST_MESSAGE_MAX,
  useJoinByPublicLinkMutation,
  usePublicJoinLinkPreview,
  useWithdrawJoinRequestMutation,
  type PublicJoinLinkPreviewData,
} from "../api/publicLink";
import { INVALID_LINK_MESSAGE, publicLinkErrorMessage } from "../linkErrors";

interface PublicLinkJoinPageProps {
  /** The link's token from the `/join/:token` path, `rim_pjl_…`. */
  token: string;
  /** The session cookie is still being checked, so who is signed in is not known yet. */
  isHydrating: boolean;
  /** The signed-in account, or null. */
  userId: string | null;
}

const ERROR_BOX =
  "rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger";

/**
 * The `/join/:token` page for a workspace's public link. It shows the workspace's name and
 * what the visitor can do: sign in or create an account (signed out), join or ask to join
 * (signed in), open the workspace (a member), wait for the moderators with Withdraw request
 * (asked already), or that they are banned. Every invalid link says "This link isn't valid";
 * too many of them from one address say when to try again. The link never creates an account:
 * "Create an account" is the server's own signup, which comes back here afterwards.
 */
export function PublicLinkJoinPage({ token, isHydrating, userId }: PublicLinkJoinPageProps) {
  const preview = usePublicJoinLinkPreview(token, userId, !isHydrating);

  if (isHydrating) return <RestoringSession />;

  if (preview.isPending) {
    return (
      <Centered>
        <p className="text-sm text-rim-text-muted">Loading link...</p>
      </Centered>
    );
  }

  if (preview.isError) {
    const code = graphqlErrorCode(preview.error);
    const known = code === NOT_FOUND || code === RATE_LIMITED;
    return (
      <Centered>
        <div className="w-full max-w-sm space-y-4 text-center">
          <p role="alert" className="text-sm text-rim-danger">
            {code === NOT_FOUND
              ? INVALID_LINK_MESSAGE
              : known
                ? publicLinkErrorMessage(preview.error, "")
                : "Couldn't load this link. Check your connection and try again."}
          </p>
          {!known && (
            <Button type="button" variant="secondary" onClick={() => void preview.refetch()}>
              Try again
            </Button>
          )}
        </div>
      </Centered>
    );
  }

  return <LinkCard token={token} preview={preview.data} />;
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-rim-void p-4">{children}</div>
  );
}

function LinkCard({ token, preview }: { token: string; preview: PublicJoinLinkPreviewData }) {
  const asks = preview.mode === PublicJoinLinkMode.REQUESTS;
  return (
    <Centered>
      <div className="w-full max-w-lg space-y-6">
        <header className="text-center">
          <BrandHeading />
          <p className="mt-1 text-sm text-rim-text-muted">
            {asks ? "You can ask to join" : "You can join"}
          </p>
          <h2 className="mt-2 text-lg font-semibold text-rim-text">{preview.name}</h2>
        </header>
        <div className="rounded-xl border border-rim-line bg-rim-panel p-6">
          <ViewerAction token={token} preview={preview} />
        </div>
      </div>
    </Centered>
  );
}

function ViewerAction({ token, preview }: { token: string; preview: PublicJoinLinkPreviewData }) {
  switch (preview.viewer) {
    case PublicJoinLinkViewer.SIGNED_OUT:
      return <SignedOut token={token} asks={preview.mode === PublicJoinLinkMode.REQUESTS} />;
    case PublicJoinLinkViewer.MEMBER:
      return <AlreadyMember preview={preview} />;
    case PublicJoinLinkViewer.BANNED:
      return (
        <p role="alert" className={ERROR_BOX}>
          You are banned from this workspace, so you cannot join it or ask to.
        </p>
      );
    case PublicJoinLinkViewer.REQUEST_OPEN:
      return <Waiting preview={preview} />;
    case PublicJoinLinkViewer.NOT_MEMBER:
      return preview.mode === PublicJoinLinkMode.REQUESTS ? (
        <AskToJoin token={token} />
      ) : (
        <JoinDirectly token={token} />
      );
    default: {
      const _exhaustive: never = preview.viewer;
      throw new Error(`Unhandled PublicJoinLinkViewer: ${String(_exhaustive)}`);
    }
  }
}

function SignedOut({ token, asks }: { token: string; asks: boolean }) {
  const navigate = useNavigate();
  const { data: serverConfig } = useServerConfig();
  const returnTo = `/join/${token}`;
  const inviteOnly = serverConfig?.registrationMode === RegistrationMode.INVITE_ONLY;

  return (
    <div className="space-y-4">
      <p className="text-sm text-rim-text-muted">
        {asks
          ? "Sign in to ask to join this workspace."
          : "Sign in to join this workspace with your account."}{" "}
        No account yet? Create one first, then you come back to this link.
      </p>
      {inviteOnly && (
        <p className="text-xs text-rim-text-faint">
          This server creates accounts only with an invite from someone on it. This link lets
          accounts that already exist join; it does not create one.
        </p>
      )}
      <div className="flex flex-col gap-2">
        <Button type="button" onClick={() => navigate("/login", { state: { returnTo } })}>
          Sign in
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => navigate("/join", { state: { returnTo } })}
        >
          Create an account
        </Button>
      </div>
    </div>
  );
}

/** Reads the link again after a refusal, which can mean the visitor's standing changed. */
function rereadStanding(qc: ReturnType<typeof useQueryClient>, token: string) {
  void qc.invalidateQueries({ queryKey: ["publicJoinLinkPreview", token] });
}

/** Opens `serverId` in the app. */
function useOpenWorkspace() {
  const navigate = useNavigate();
  const setWorkspaceId = useWorkspaceStore((s) => s.setWorkspaceId);
  return (serverId: string) => {
    setWorkspaceId(serverId);
    navigate("/");
  };
}

function AlreadyMember({ preview }: { preview: PublicJoinLinkPreviewData }) {
  const open = useOpenWorkspace();
  return (
    <div className="space-y-4">
      <p className="text-sm text-rim-text-muted">You are already a member of this workspace.</p>
      <Button type="button" className="w-full" onClick={() => open(preview.serverId)}>
        Open workspace
      </Button>
    </div>
  );
}

function Waiting({ preview }: { preview: PublicJoinLinkPreviewData }) {
  const navigate = useNavigate();
  const withdraw = useWithdrawJoinRequestMutation();
  const requestId = preview.joinRequestId;

  return (
    <div className="space-y-4">
      <div role="status">
        <p className="text-sm font-medium text-rim-text">Waiting for the moderators</p>
        <p className="mt-1 text-sm text-rim-text-muted">
          You asked to join this workspace. RIM tells you when a moderator accepts or declines, and
          the workspace appears in your list once you are in.
        </p>
      </div>
      {withdraw.error && (
        <p role="alert" className={ERROR_BOX}>
          {publicLinkErrorMessage(withdraw.error, "Could not withdraw the request.")}
        </p>
      )}
      <div className="flex flex-col gap-2">
        <Button type="button" onClick={() => navigate("/")}>
          Open RIM
        </Button>
        {requestId && (
          <Button
            type="button"
            variant="secondary"
            isLoading={withdraw.isPending}
            onClick={() => withdraw.mutate(requestId)}
          >
            Withdraw request
          </Button>
        )}
      </div>
    </div>
  );
}

function JoinDirectly({ token }: { token: string }) {
  const join = useJoinByPublicLinkMutation();
  const open = useOpenWorkspace();
  const qc = useQueryClient();

  return (
    <div className="space-y-4">
      <p className="text-sm text-rim-text-muted">
        Anyone with this link can join. You join with your account on this server.
      </p>
      {join.error && (
        <p role="alert" className={ERROR_BOX}>
          {publicLinkErrorMessage(join.error, "Could not join the workspace.")}
        </p>
      )}
      <Button
        type="button"
        className="w-full"
        isLoading={join.isPending}
        onClick={() =>
          join.mutate(
            { token },
            {
              onSuccess: (result) => {
                if (result.outcome === JoinByPublicLinkOutcome.JOINED) open(result.serverId);
              },
              onError: () => rereadStanding(qc, token),
            },
          )
        }
      >
        {join.isPending ? "Joining..." : "Join"}
      </Button>
    </div>
  );
}

function AskToJoin({ token }: { token: string }) {
  const join = useJoinByPublicLinkMutation();
  const open = useOpenWorkspace();
  const qc = useQueryClient();
  const messageId = useId();
  const [message, setMessage] = useState("");
  const tooLong = message.length > JOIN_REQUEST_MESSAGE_MAX;

  function ask() {
    if (tooLong) return;
    const trimmed = message.trim();
    join.mutate(
      { token, message: trimmed || null },
      {
        // A link switched to direct joins in the meantime joins at once.
        onSuccess: (result) => {
          if (result.outcome === JoinByPublicLinkOutcome.JOINED) open(result.serverId);
        },
        onError: () => rereadStanding(qc, token),
      },
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-rim-text-muted">
        The moderators of this workspace decide who joins. You can add a short message for them.
      </p>
      <div>
        <label htmlFor={messageId} className="mb-1 block text-xs font-medium text-rim-text">
          Message to the moderators (optional)
        </label>
        <textarea
          id={messageId}
          rows={3}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          aria-invalid={tooLong}
          className="w-full resize-none rounded-lg border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none placeholder:text-rim-text-faint focus:border-rim-accent"
        />
        <p className={tooLong ? "text-xs text-rim-danger" : "text-xs text-rim-text-faint"}>
          {message.length} / {JOIN_REQUEST_MESSAGE_MAX}
        </p>
      </div>
      {join.error && (
        <p role="alert" className={ERROR_BOX}>
          {publicLinkErrorMessage(join.error, "Could not ask to join.")}
        </p>
      )}
      <Button
        type="button"
        className="w-full"
        disabled={tooLong}
        isLoading={join.isPending}
        onClick={ask}
      >
        {join.isPending ? "Asking..." : "Ask to join"}
      </Button>
    </div>
  );
}
