/**
 * `JoinPage` — the `/join/:token` route component.
 *
 * Orchestrates the invite token preview → signup flow:
 *
 * 1. Extracts `token` from `useParams`. Missing token → `InvalidTokenState`.
 * 2. Calls `usePreviewInviteToken(token)` — no auth required.
 * 3. While loading: shows a loading skeleton.
 * 4. On preview error: shows `InvalidTokenState` with a code-keyed copy.
 * 5. If user is authenticated: renders `JoinAuthenticated` (workspace join or
 *    instance-token error).
 * 6. Otherwise: renders `JoinForm` with the appropriate variant copy.
 *
 * Post-signup navigation:
 * - Workspace token (`serverId` present): set workspace, navigate to `/`.
 * - Instance token (`serverId` absent): navigate to `/`. `AppShell` shows the
 *   empty-workspace state (user has no workspaces yet).
 *
 * Security note (L3): A `<meta name="referrer" content="no-referrer">` tag is
 * injected on mount and removed on unmount. The invite token is in the URL path;
 * suppressing the Referer header prevents it from leaking to third-party origins
 * (e.g. any CDN assets or analytics the browser might contact). Defense-in-depth
 * — the global `strict-origin-when-cross-origin` policy already sends only the
 * origin, not the full path, to cross-origin targets. We suppress even the origin
 * here as an additional precaution.
 */

import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useNavigate } from "react-router-dom";

import { useAuthStore } from "../state/useAuthStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { usePreviewInviteToken, extractInviteErrorCode } from "../api/usePreviewInviteToken";
import { InviteTokenType } from "../types";
import { JoinForm } from "./JoinForm";
import { JoinAuthenticated } from "./JoinAuthenticated";
import { InvalidTokenState } from "./InvalidTokenState";

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

interface JoinPageWithTokenProps {
  token: string;
  isAuthenticated: boolean;
  onSignupSuccess: (userId: string, serverId: string | null) => void;
}

function JoinPageWithToken({ token, isAuthenticated, onSignupSuccess }: JoinPageWithTokenProps) {
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
        onRetry={code === "NETWORK" ? () => { void refetch(); } : undefined}
      />
    );
  }

  if (isAuthenticated) {
    return (
      <JoinAuthenticated
        token={token}
        tokenType={preview.tokenType}
        workspaceName={preview.workspace?.serverName}
      />
    );
  }

  return (
    <JoinForm
      variant={preview.tokenType as InviteTokenType}
      token={token}
      workspaceName={preview.workspace?.serverName}
      onSuccess={onSignupSuccess}
    />
  );
}
