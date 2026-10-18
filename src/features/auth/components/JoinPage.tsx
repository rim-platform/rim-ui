/**
 * `JoinPage` — the `/join/:token` route component.
 *
 * Orchestrates the invite token preview → signup flow:
 *
 * 1. Extracts `token` from `useParams`. Missing token → `InvalidTokenState`.
 * 2. Calls `usePreviewInviteToken(token)` — no auth required.
 * 3. While loading: shows a loading skeleton.
 * 4. On preview error: shows `InvalidTokenState` with a code-keyed copy.
 * 5. While `useSessionHydration` checks the session cookie (a fresh tab starts with an empty
 *    auth store): shows "Restoring session...".
 * 6. If user is authenticated: renders `JoinAuthenticated` (workspace join or
 *    instance-token error).
 * 7. Otherwise: renders `JoinForm` with the appropriate variant copy.
 *
 * Post-signup navigation:
 * - Workspace token (`serverId` present): set workspace, navigate to `/`.
 * - Instance token (`serverId` absent): navigate to `/`. `WorkspaceSelector` opens the
 *   server's default workspace, or shows the empty-workspace state when the server names none.
 *
 * Security note: A `<meta name="referrer" content="no-referrer">` tag is
 * injected on mount and removed on unmount. The invite token is in the URL path;
 * suppressing the Referer header prevents it from leaking to third-party origins
 * (e.g. any CDN assets or analytics the browser might contact). Defense-in-depth
 * — the global `strict-origin-when-cross-origin` policy already sends only the
 * origin, not the full path, to cross-origin targets; this page suppresses even
 * the origin as an additional precaution.
 */

import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useNavigate } from "react-router-dom";

import { useAuthStore } from "../state/useAuthStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { usePreviewInviteToken, extractInviteErrorCode } from "../api/usePreviewInviteToken";
import { useSessionHydration } from "../api/useSessionHydration";
import { InviteTokenType } from "../types";
import { JoinForm } from "./JoinForm";
import { JoinAuthenticated } from "./JoinAuthenticated";
import { InvalidTokenState } from "./InvalidTokenState";
import { RestoringSession } from "./RestoringSession";

/**
 * Injects `<meta name="referrer" content="no-referrer">` into `document.head`
 * on mount and removes it on unmount. Used on routes that carry sensitive tokens
 * in their URL path to prevent token leakage via the Referer header.
 */
function useNoReferrerMeta(): void {
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "referrer";
    meta.content = "no-referrer";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);
}

export function JoinPage() {
  useNoReferrerMeta();
  const { token } = useParams<{ token: string }>();
  const { isHydrating } = useSessionHydration();
  const session = useAuthStore((s) => s.session);
  const setSession = useAuthStore((s) => s.setSession);
  const setWorkspaceId = useWorkspaceStore((s) => s.setWorkspaceId);
  const navigate = useNavigate();

  if (!token) {
    return <InvalidTokenState code="INVALID_TOKEN" />;
  }

  return (
    <JoinPageWithToken
      token={token}
      isHydrating={isHydrating}
      isAuthenticated={!!session}
      onSignupSuccess={(userId, serverId) => {
        setSession({ userId });
        if (serverId) {
          setWorkspaceId(serverId);
        }
        navigate("/");
      }}
    />
  );
}

/**
 * Maps an `InviteTokenType` (from a preview query) to the corresponding
 * `JoinForm` `variant` prop value.
 *
 * Implemented as an exhaustive switch with a `never`-typed default arm:
 * if a new `InviteTokenType` enum member is added server-side and pulled
 * through codegen, this function will fail to type-check until the new
 * case is mapped explicitly.
 *
 * Note: `JoinForm`'s own `JoinFormVariant` is `InviteTokenType | "CODE"`.
 * `CODE` is intentionally not produced here — it is only used by the
 * `/join` route without an invite link, whose invite code field previews its own token.
 *
 * @throws Never at runtime under correct typing. Throws an `Error` only
 *   if a non-enum value is passed at runtime (e.g. server returned an
 *   unknown string ahead of a frontend rebuild).
 */
function inviteTokenTypeToJoinFormVariant(tokenType: InviteTokenType): InviteTokenType {
  switch (tokenType) {
    case InviteTokenType.WORKSPACE:
      return InviteTokenType.WORKSPACE;
    case InviteTokenType.INSTANCE:
      return InviteTokenType.INSTANCE;
    default: {
      const _exhaustive: never = tokenType;
      throw new Error(`Unhandled InviteTokenType: ${String(_exhaustive)}`);
    }
  }
}

interface JoinPageWithTokenProps {
  token: string;
  /** The session cookie is still being checked, so who is signed in is not known yet. */
  isHydrating: boolean;
  isAuthenticated: boolean;
  onSignupSuccess: (userId: string, serverId: string | null) => void;
}

function JoinPageWithToken({
  token,
  isHydrating,
  isAuthenticated,
  onSignupSuccess,
}: JoinPageWithTokenProps) {
  const { data: preview, isPending, error, refetch } = usePreviewInviteToken(token);

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-rim-void p-4">
        <p className="text-sm text-rim-text-muted">Loading invite...</p>
      </div>
    );
  }

  if (error || !preview) {
    const code = extractInviteErrorCode(error);
    return (
      <InvalidTokenState
        code={code}
        onRetry={
          code === "NETWORK"
            ? () => {
                void refetch();
              }
            : undefined
        }
      />
    );
  }

  if (isHydrating) {
    return <RestoringSession />;
  }

  if (isAuthenticated) {
    return (
      <JoinAuthenticated
        token={token}
        tokenType={preview.tokenType}
        workspaceName={preview.workspace?.serverName}
        workspaceId={preview.workspace?.serverId}
        invitedBy={preview.workspace?.invitedByDisplayName}
        ownerName={preview.workspace?.ownerDisplayName}
      />
    );
  }

  return (
    <JoinForm
      variant={inviteTokenTypeToJoinFormVariant(preview.tokenType)}
      token={token}
      workspaceName={preview.workspace?.serverName}
      workspaceId={preview.workspace?.serverId}
      invitedBy={preview.workspace?.invitedByDisplayName}
      ownerName={preview.workspace?.ownerDisplayName}
      onSuccess={onSignupSuccess}
    />
  );
}
