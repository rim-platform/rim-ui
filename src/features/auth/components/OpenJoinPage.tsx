/**
 * `OpenJoinPage` — the `/join` (no token) route component.
 *
 * Only functional when the server reports `registrationMode === "OPEN"`.
 * In all other cases (including while loading, which defaults to
 * `INVITE_ONLY` for safety), renders a 404-like message and schedules a
 * redirect to `/login` after 3 seconds.
 *
 * When open registration is available, renders `JoinForm` with the `"OPEN"`
 * variant. Signup submits without any token field; the backend rate-limits
 * this endpoint.
 *
 * Post-signup: navigate to `/`. `AppShell` shows the empty-workspace state
 * because the new account has no workspace memberships.
 */

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { useAuthStore } from "../state/useAuthStore";
import { useServerConfig } from "../api/useServerConfig";
import { RegistrationMode } from "../types";
import { JoinForm } from "./JoinForm";
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
  const setSession = useAuthStore((s) => s.setSession);
  const setWorkspaceId = useWorkspaceStore((s) => s.setWorkspaceId);

  const isOpen = serverConfig?.registrationMode === RegistrationMode.OPEN;

  // Redirect to /login when invite-only (or still loading — safe default).
  useEffect(() => {
    if (isPending || isOpen) return;

    const timer = setTimeout(() => {
      navigate("/login", { replace: true });
    }, 3000);

    return () => clearTimeout(timer);
  }, [isPending, isOpen, navigate]);

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-rim-void p-4">
        <p className="text-sm text-rim-text-muted">Loading...</p>
      </div>
    );
  }

  if (!isOpen) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-rim-void p-4">
        <div className="w-full max-w-sm text-center space-y-2">
          <p className="text-sm text-rim-text-muted">
            Registration is invite-only on this RIM instance.
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

  return <JoinForm variant="OPEN" token={null} onSuccess={handleSuccess} />;
}
