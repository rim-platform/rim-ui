/**
 * `OpenJoinPage` — the `/join` (no token) route component.
 *
 * Renders `JoinForm` with the `"CODE"` variant, whose "Invite code" field takes the code or
 * the whole invite link, once the server's registration mode is known:
 * - `INVITE_ONLY`: the code is required, and the signup sends it.
 * - `OPEN`: the code is optional; the signup sends no token and the backend rate-limits it.
 * - `POW`, in the desktop app: a relay in pow mode takes a key-only signup with a proof-of-work
 *   or an invite instead, so the form offers only the key, with the code optional.
 *
 * While the mode loads it shows "Loading...". In the web app on a pow server, or when the mode
 * cannot be read, it says so and redirects to `/login` after 3 seconds.
 *
 * Post-signup: navigate to `/`, with the invite's workspace open for a workspace invite.
 * Otherwise `WorkspaceSelector` opens the server's default workspace, which every new account
 * joins, or shows the empty-workspace state when the server names none.
 *
 * A signed-in account has no use for the form: once `useSessionHydration` has checked the
 * session cookie, it is sent on to `/`.
 */

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { useAuthStore } from "../state/useAuthStore";
import { useServerConfig } from "../api/useServerConfig";
import { useSessionHydration } from "../api/useSessionHydration";
import { RegistrationMode } from "../types";
import { JoinForm } from "./JoinForm";
import { RestoringSession } from "./RestoringSession";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";

/**
 * Route component for account registration without an invite link.
 *
 * Renders a refusal with a 3-second redirect to `/login` where this app cannot sign up here.
 */
export function OpenJoinPage() {
  const navigate = useNavigate();
  const { data: serverConfig, isPending } = useServerConfig();
  const { isHydrating } = useSessionHydration();
  const session = useAuthStore((s) => s.session);
  const setSession = useAuthStore((s) => s.setSession);
  const setWorkspaceId = useWorkspaceStore((s) => s.setWorkspaceId);
  const { capabilities } = useRuntime();

  const registrationMode = serverConfig?.registrationMode;
  const isPow = registrationMode === RegistrationMode.POW;
  const canSignUp =
    registrationMode === RegistrationMode.OPEN ||
    registrationMode === RegistrationMode.INVITE_ONLY ||
    (isPow && capabilities.identityKeys);

  useEffect(() => {
    if (!isHydrating && session) navigate("/", { replace: true });
  }, [isHydrating, session, navigate]);

  // Redirect to /login where this app cannot sign up here.
  useEffect(() => {
    if (isPending || canSignUp || isHydrating || session) return;

    const timer = setTimeout(() => {
      navigate("/login", { replace: true });
    }, 3000);

    return () => clearTimeout(timer);
  }, [isPending, canSignUp, isHydrating, session, navigate]);

  if (isHydrating) {
    return <RestoringSession />;
  }

  // While already navigating away, render nothing to avoid flicker.
  if (session) {
    return null;
  }

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-rim-void p-4">
        <p className="text-sm text-rim-text-muted">Loading...</p>
      </div>
    );
  }

  if (!canSignUp) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-rim-void p-4">
        <div className="w-full max-w-sm text-center space-y-2">
          <p className="text-sm text-rim-text-muted">
            {isPow
              ? "Signing up here takes the RIM desktop app, or an invite."
              : "Could not read how this server creates accounts."}
          </p>
          <p className="text-xs text-rim-text-faint">Redirecting to login...</p>
        </div>
      </div>
    );
  }

  function handleSuccess(userId: string, serverId: string | null) {
    setSession({ userId });
    if (serverId) {
      setWorkspaceId(serverId);
    }
    navigate("/");
  }

  return (
    <JoinForm
      variant="CODE"
      token={null}
      registrationMode={registrationMode}
      keyOnly={isPow}
      onSuccess={handleSuccess}
    />
  );
}
