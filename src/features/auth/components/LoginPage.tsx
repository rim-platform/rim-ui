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
 * - `POW` (a public relay): the same link where this app can hold keys, which signs up with a
 *   key and a proof-of-work; elsewhere, copy that points to the desktop app or an invite.
 * - A server that takes key signups only (`serverInfo.signupRequiresKeys`) in `OPEN` mode, in a
 *   browser that cannot create keys: copy that points to the desktop app instead of the link.
 *
 * **Session redirect:** if a session is already restored via
 * `useSessionHydration`, navigates immediately to `state.returnTo ?? "/"` so
 * the login page is never shown to an authenticated user.
 *
 * **Server notices:** the operator's instance notice at the top, an alert when the server
 * blocked this address, and a note when the server ended the last session.
 *
 * **Key sign-in:** above the password form, "Sign in with this device" for each account this
 * computer, or this browser, holds a key for; below it, "Link this device" with a code from
 * another device and, where this app can hold an identity key, recovery with a recovery kit.
 *
 * **Server:** on the desktop, the server it signs in to and a way to move to another one.
 */

import { useEffect } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";

import { useEdgeStore } from "../../../core/graphql/edgeRefusals";
import { ADDRESS_BLOCKED_MESSAGE } from "../../../core/graphql/errors";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { InstanceNotice } from "../../updater/components/InstanceNotice";
import { useServerInfo } from "../../updater/hooks/useServerInfo";
import { useAuthStore } from "../state/useAuthStore";
import { useSessionHydration } from "../api/useSessionHydration";
import { useServerConfig } from "../api/useServerConfig";
import { SESSION_ENDED_MESSAGE } from "../runtime/signOut";
import { RegistrationMode } from "../types";
import { LoginForm } from "./LoginForm";
import { HealthIndicator } from "./HealthIndicator";
import { RestoringSession } from "./RestoringSession";
import { DeviceKeySignIn, RecoverAccount } from "../../key-identity/components/DeviceKeySignIn";
import { LinkThisDevice } from "../../key-identity/components/LinkThisDevice";
import { BrandHeading } from "./BrandHeading";
import { ServerChoice } from "./ServerChoice";

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
  const { capabilities, deviceKeyStore } = useRuntime();
  const keysRequired = useServerInfo().signupRequiresKeys === true;
  const blocked = useEdgeStore((s) => s.blocked);
  const sessionEnded = useAuthStore((s) => s.sessionEnded);

  // If already authenticated, send directly to the intended destination.
  useEffect(() => {
    if (!isHydrating && session) {
      const returnTo = (location.state as { returnTo?: string } | null)?.returnTo ?? "/";
      navigate(returnTo, { replace: true });
    }
  }, [isHydrating, session, navigate, location.state]);

  if (isHydrating) {
    return <RestoringSession />;
  }

  // While already navigating away, render nothing to avoid flicker.
  if (session) {
    return null;
  }

  const registrationMode = serverConfig?.registrationMode;
  const isPow = registrationMode === RegistrationMode.POW;
  // While the browser is probed, the join page says whether it can sign up.
  const noKeysHere = !capabilities.identityKeys && deviceKeyStore !== "checking";
  const keyOnlyHere = registrationMode === RegistrationMode.OPEN && keysRequired && noKeysHere;
  // A relay in pow mode takes key-only signups without an invite, which needs keys here.
  const canCreate =
    (registrationMode === RegistrationMode.OPEN && !keyOnlyHere) ||
    (isPow && capabilities.identityKeys);

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
          <BrandHeading />
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

        {sessionEnded && (
          <p
            role="status"
            className="rounded-lg border border-rim-line bg-rim-panel px-3 py-2 text-sm text-rim-text"
          >
            {SESSION_ENDED_MESSAGE}
          </p>
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
        ) : keyOnlyHere ? (
          <p className="text-center text-xs text-rim-text-muted">
            No account? This server signs up new accounts with a key, which this browser cannot
            create. Create one in the RIM desktop app.
          </p>
        ) : isPow ? (
          <p className="text-center text-xs text-rim-text-muted">
            No account? Create one in the RIM desktop app, or ask for an invite.
          </p>
        ) : (
          <p className="text-center text-xs text-rim-text-muted">
            No account? Ask your workspace admin for an invite.
          </p>
        )}

        <ServerChoice />
      </div>
    </div>
  );
}
