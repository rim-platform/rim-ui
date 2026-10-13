/**
 * `OpenJoinPage` — the `/join` (no token) route component.
 *
 * Functional when the server reports `registrationMode === "OPEN"`, or `"POW"` in the desktop
 * app: a relay in pow mode takes a key-only signup with a proof-of-work instead of a token, so
 * the form offers only the key. In all other cases (including while loading, which defaults to
 * `INVITE_ONLY` for safety), renders a 404-like message and schedules a redirect to `/login`
 * after 3 seconds.
 *
 * When open registration is available, renders `JoinForm` with the `"OPEN"`
 * variant. Signup submits without any token field; the backend rate-limits
 * this endpoint.
 *
 * Post-signup: navigate to `/`. `AppShell` shows the empty-workspace state
 * because the new account has no workspace memberships.
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
 * Route component for open (tokenless) account registration.
 *
 * Renders a forbidden state with a 3-second redirect to `/login` when the
 * server is in `INVITE_ONLY` mode or while the config is still loading.
 */
export function OpenJoinPage() {
  const navigate = useNavigate();
  const { data: serverConfig, isPending } = useServerConfig();
  const { isHydrating } = useSessionHydration();
  const session = useAuthStore((s) => s.session);
  const setSession = useAuthStore((s) => s.setSession);
  const setWorkspaceId = useWorkspaceStore((s) => s.setWorkspaceId);
  const { capabilities } = useRuntime();

  const isPow = serverConfig?.registrationMode === RegistrationMode.POW;
  const canSignUp =
    serverConfig?.registrationMode === RegistrationMode.OPEN ||
    (isPow && capabilities.identityKeys);

  useEffect(() => {
    if (!isHydrating && session) navigate("/", { replace: true });
  }, [isHydrating, session, navigate]);

  // Redirect to /login when invite-only (or still loading — safe default).
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
              : "Registration is invite-only on this RIM instance."}
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

  return <JoinForm variant="OPEN" token={null} keyOnly={isPow} onSuccess={handleSuccess} />;
}
