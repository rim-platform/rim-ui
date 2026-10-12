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
 * - `POW` (a public relay): the same link in the desktop app, which signs up with a key and a
 *   proof-of-work; in the web app, copy that points to the desktop app or an invite.
 *
 * **Session redirect:** if a session is already restored via
 * `useSessionHydration`, navigates immediately to `state.returnTo ?? "/"` so
 * the login page is never shown to an authenticated user.
 *
 * **Server notices:** the operator's instance notice at the top, and an alert when the server
 * blocked this address.
 *
 * **Key sign-in:** above the password form, "Sign in with this device" for each account this
 * computer, or this browser once linked, holds a key for; below it, "Link this device" with a
 * code from another device and, on the desktop, recovery with a recovery kit.
 */

import { useEffect } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";

import { useEdgeStore } from "../../../core/graphql/edgeRefusals";
import { ADDRESS_BLOCKED_MESSAGE } from "../../../core/graphql/errors";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { InstanceNotice } from "../../updater/components/InstanceNotice";
import { useAuthStore } from "../state/useAuthStore";
import { useSessionHydration } from "../api/useSessionHydration";
import { useServerConfig } from "../api/useServerConfig";
import { RegistrationMode } from "../types";
import { LoginForm } from "./LoginForm";
import { HealthIndicator } from "./HealthIndicator";
import { DeviceKeySignIn, RecoverAccount } from "../../key-identity/components/DeviceKeySignIn";
import { LinkThisDevice } from "../../key-identity/components/LinkThisDevice";

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
  const { capabilities } = useRuntime();
  const blocked = useEdgeStore((s) => s.blocked);

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
  const isPow = registrationMode === RegistrationMode.POW;
  // A relay in pow mode takes key-only signups without an invite, which the desktop app makes.
  const canCreate =
    registrationMode === RegistrationMode.OPEN || (isPow && capabilities.identityKeys);

  function handleLoginSuccess(userId: string) {
    setSession({ userId });
    const returnTo = (location.state as { returnTo?: string } | null)?.returnTo ?? "/";
    navigate(returnTo, { replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-rim-void p-4">
      <div className="w-full max-w-lg space-y-6">
        <InstanceNotice />

        <header className="text-center">
          <h1 className="text-2xl font-semibold text-rim-text">RIM</h1>
          <p className="mt-1 text-sm text-rim-text-muted">Sign in to your workspace</p>
        </header>

        <HealthIndicator />

        {blocked && (
          <div
            role="alert"
            className="rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger"
          >
            <p className="font-medium">{ADDRESS_BLOCKED_MESSAGE}</p>
            <p className="mt-1 text-xs">
              The server refuses every request from this network address. Ask whoever runs it if you
              think this is a mistake.
            </p>
          </div>
        )}

        <DeviceKeySignIn onSuccess={handleLoginSuccess} />

        <div className="rounded-xl border border-rim-line bg-rim-panel p-6">
          <LoginForm onSuccess={handleLoginSuccess} />
        </div>

        <LinkThisDevice onSuccess={handleLoginSuccess} />

        <RecoverAccount onSuccess={handleLoginSuccess} />

        {canCreate ? (
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
        ) : isPow ? (
          <p className="text-center text-xs text-rim-text-muted">
            No account? Create one in the RIM desktop app, or ask for an invite.
          </p>
        ) : (
          <p className="text-center text-xs text-rim-text-muted">
            No account? Ask your workspace admin for an invite.
          </p>
        )}
      </div>
    </div>
  );
}
