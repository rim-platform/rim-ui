/**
 * `LoginPage` — the `/login` route component.
 *
 * Offers the ways an account signs in, with contextual copy based on `registrationMode`:
 *
 * - While loading, the safe fallback: the copy "No account? Ask your workspace admin for an
 *   invite." as plain text below the sign-in card.
 * - `OPEN`: shows a `─── OR ───` divider and a "Create account" link to `/join` instead.
 * - `INVITE_ONLY`: the same link, whose form asks for the invite code, with copy saying that an
 *   account here takes one.
 * - `POW` (a public relay): the same link where this app can hold keys, which signs up with a
 *   key and a proof-of-work; elsewhere, copy that points to the desktop app or an invite.
 * - A server that is full (`serverInfo.registrationFull`): "This server is full" with a pointer
 *   to running a server, instead of the link.
 *
 * **Session redirect:** if a session is already restored via
 * `useSessionHydration`, navigates immediately to `state.returnTo ?? "/"` so
 * the login page is never shown to an authenticated user.
 *
 * **Server notices:** the operator's instance notice at the top, an alert when the server
 * blocked this address, and a note when the server ended the last session.
 *
 * **Sign-in:** in a card of its own that is hidden when none of them renders anything, "Sign in
 * with this device" for each account this computer, or this browser, holds a key for, with its
 * password; "Link this device" with a code from another device; and, where this app can hold an
 * identity key, recovery with a recovery kit. An app that cannot create keys says so in place of
 * the card, and offers no "Create account" link.
 *
 * **Server:** the operator's abuse contact when it names one and, on the desktop, the server it
 * signs in to and a way to move to another one.
 */

import { useEffect } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";

import { useEdgeStore } from "../../../core/graphql/edgeRefusals";
import { ADDRESS_BLOCKED_MESSAGE } from "../../../core/graphql/errors";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { InstanceNotice } from "../../updater/components/InstanceNotice";
import { useServerInfo } from "../../updater/hooks/useServerInfo";
import { useAuthStore } from "../state/useAuthStore";
import { NEEDS_CONNECTION_MESSAGE, useSessionHydration } from "../api/useSessionHydration";
import { useServerConfig } from "../api/useServerConfig";
import { SESSION_ENDED_MESSAGE } from "../runtime/signOut";
import { RegistrationMode } from "../types";
import { HealthIndicator } from "./HealthIndicator";
import { RestoringSession } from "./RestoringSession";
import { DeviceKeySignIn, RecoverAccount } from "../../key-identity/components/DeviceKeySignIn";
import { LinkThisDevice } from "../../key-identity/components/LinkThisDevice";
import { BrandHeading } from "./BrandHeading";
import { ServerChoice } from "./ServerChoice";
import { AbuseContact } from "./AbuseContact";
import { RegistrationFullNotice } from "./RegistrationFullNotice";
import { NoKeysHere } from "./NoKeysHere";

/**
 * Top-level component for the `/login` route.
 *
 * Manages session redirect and delegates each way to sign in to its own component.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isHydrating, needsConnection } = useSessionHydration();
  const session = useAuthStore((s) => s.session);
  const setSession = useAuthStore((s) => s.setSession);
  const { data: serverConfig } = useServerConfig();
  const { capabilities, deviceKeyStore } = useRuntime();
  const serverInfo = useServerInfo();
  const full = serverInfo.info?.registrationFull === true;
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
  const inviteOnly = registrationMode === RegistrationMode.INVITE_ONLY;
  // While the browser is probed, the key ways to sign in and the join page say what it can do.
  const noKeysHere = !capabilities.identityKeys && deviceKeyStore !== "checking";
  // A relay in pow mode takes key signups without an invite, which needs keys here.
  const canCreate =
    ((registrationMode === RegistrationMode.OPEN || inviteOnly) && !noKeysHere) ||
    (isPow && capabilities.identityKeys);

  function handleLoginSuccess(userId: string) {
    setSession({ userId });
    const returnTo = (location.state as { returnTo?: string } | null)?.returnTo ?? "/";
    navigate(returnTo, { replace: true });
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-rim-void p-4">
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

        {needsConnection && (
          <p
            role="status"
            className="rounded-lg border border-rim-line bg-rim-panel px-3 py-2 text-sm text-rim-text"
          >
            {NEEDS_CONNECTION_MESSAGE}
          </p>
        )}

        {sessionEnded && (
          <p
            role="status"
            className="rounded-lg border border-rim-line bg-rim-panel px-3 py-2 text-sm text-rim-text"
          >
            {SESSION_ENDED_MESSAGE}
          </p>
        )}

        {noKeysHere ? (
          <div className="rounded-xl border border-rim-line bg-rim-panel p-6">
            <NoKeysHere />
          </div>
        ) : (
          <section
            aria-label="Sign in with a key"
            className="space-y-4 rounded-xl border border-rim-line bg-rim-panel p-6 empty:hidden"
          >
            <DeviceKeySignIn onSuccess={handleLoginSuccess} />
            <LinkThisDevice onSuccess={handleLoginSuccess} />
            <RecoverAccount onSuccess={handleLoginSuccess} />
          </section>
        )}

        {full ? (
          <RegistrationFullNotice />
        ) : canCreate ? (
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
            {inviteOnly && (
              <p className="text-xs text-rim-text-muted">
                Creating an account here takes an invite code or link from someone on this server.
              </p>
            )}
          </div>
        ) : noKeysHere ? null : isPow ? (
          <p className="text-center text-xs text-rim-text-muted">
            No account? Create one in the RIM desktop app, or ask for an invite.
          </p>
        ) : (
          <p className="text-center text-xs text-rim-text-muted">
            No account? Ask your workspace admin for an invite.
          </p>
        )}

        <AbuseContact />

        <ServerChoice />
      </div>
    </div>
  );
}
