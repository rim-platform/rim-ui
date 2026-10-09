/**
 * `LoginPage` — the `/login` route component.
 *
 * Renders the login form with contextual copy based on `registrationMode`:
 *
 * - `INVITE_ONLY` (default, and the safe fallback while loading): shows the
 *   locked copy "No account? Ask your workspace admin for an invite." as plain
 *   text below the form card.
 * - `OPEN`: shows a `─── OR ───` divider and a "Create account" link to
 *   `/join` instead.
 *
 * **Session redirect:** if a session is already restored via
 * `useSessionHydration`, navigates immediately to `state.returnTo ?? "/"` so
 * the login page is never shown to an authenticated user.
 *
 * **Key sign-in (desktop):** above the password form, "Sign in with this device" for each
 * account this computer holds a key for; below it, recovery with a recovery kit.
 *
 * **Bootstrap mode is removed.** The `BootstrapForm` component and its tab
 * strip are gone from the UI. The CLI handles bootstrap via the same mutation;
 * `useBootstrapMutation` is preserved in the API layer.
 */

import { useEffect } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";

import { useAuthStore } from "../state/useAuthStore";
import { useSessionHydration } from "../api/useSessionHydration";
import { useServerConfig } from "../api/useServerConfig";
import { RegistrationMode } from "../types";
import { LoginForm } from "./LoginForm";
import { HealthIndicator } from "./HealthIndicator";
import { DeviceKeySignIn, RecoverAccount } from "../../key-identity/components/DeviceKeySignIn";

/**
 * Top-level component for the `/login` route.
 *
 * Manages session redirect and delegates form rendering to `LoginForm`.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isHydrating } = useSessionHydration();
  const session = useAuthStore((s) => s.session);
  const setSession = useAuthStore((s) => s.setSession);
  const { data: serverConfig } = useServerConfig();

  // If already authenticated, send directly to the intended destination.
  useEffect(() => {
    if (!isHydrating && session) {
      const returnTo = (location.state as { returnTo?: string } | null)?.returnTo ?? "/";
      navigate(returnTo, { replace: true });
    }
  }, [isHydrating, session, navigate, location.state]);

  if (isHydrating) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-rim-void p-4">
        <p className="text-sm text-rim-text-muted">Restoring session...</p>
      </div>
    );
  }

  // While already navigating away, render nothing to avoid flicker.
  if (session) {
    return null;
  }

  const registrationMode = serverConfig?.registrationMode;
  const isOpen = registrationMode === RegistrationMode.OPEN;

  function handleLoginSuccess(userId: string) {
    setSession({ userId });
    const returnTo = (location.state as { returnTo?: string } | null)?.returnTo ?? "/";
    navigate(returnTo, { replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-rim-void p-4">
      <div className="w-full max-w-lg space-y-6">
        <header className="text-center">
          <h1 className="text-2xl font-semibold text-rim-text">RIM</h1>
          <p className="mt-1 text-sm text-rim-text-muted">Sign in to your workspace</p>
        </header>

        <HealthIndicator />

        <DeviceKeySignIn onSuccess={handleLoginSuccess} />

        <div className="rounded-xl border border-rim-line bg-rim-panel p-6">
          <LoginForm onSuccess={handleLoginSuccess} />
        </div>

        <RecoverAccount onSuccess={handleLoginSuccess} />

        {isOpen ? (
          <div className="space-y-3 text-center">
            <div className="flex items-center gap-3 text-xs text-rim-text-faint">
              <span className="flex-1 border-t border-rim-line" />
              <span>OR</span>
              <span className="flex-1 border-t border-rim-line" />
            </div>
            <Link
              to="/join"
              className="inline-block rounded-lg border border-rim-line bg-rim-void px-4 py-2 text-sm text-rim-text-muted transition hover:text-rim-text"
            >
              Create account
            </Link>
          </div>
        ) : (
          <p className="text-center text-xs text-rim-text-muted">
            No account? Ask your workspace admin for an invite.
          </p>
        )}
      </div>
    </div>
  );
}
