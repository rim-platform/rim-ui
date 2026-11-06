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
import { Plus } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";

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
import { WayInRow } from "./WayInRow";
import { useDeviceKeyAccounts } from "../../key-identity/api/useDeviceKeyAccounts";

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
  // The same query the account cards read, so it asks the device nothing more.
  const accounts = useDeviceKeyAccounts();
  const hasAccounts = capabilities.deviceKeys && (accounts.data?.length ?? 0) > 0;

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
    <div className="flex min-h-full justify-center bg-rim-void px-4 py-12">
      <main className="w-full max-w-[440px] space-y-5">
        <InstanceNotice />

        <header className="flex flex-col items-center gap-2.5 text-center">
          <BrandHeading />
          <h2 className="text-[22px] font-semibold text-rim-text">Sign in to your workspace</h2>
          <HealthIndicator />
        </header>

        {blocked && (
          <div
            role="alert"
            className="rounded-[10px] border border-rim-danger-solid/50 bg-rim-danger-solid/15 px-3 py-2.5 text-[13px] leading-normal text-rim-danger"
          >
            <p className="font-semibold">{ADDRESS_BLOCKED_MESSAGE}</p>
            <p className="mt-1">
              The server refuses every request from this network address. Ask whoever runs it if you
              think this is a mistake.
            </p>
          </div>
        )}

        {needsConnection && (
          <p
            role="status"
            className="rounded-[10px] border border-rim-line bg-rim-panel-soft px-3 py-2.5 text-[13px] text-rim-text"
          >
            {NEEDS_CONNECTION_MESSAGE}
          </p>
        )}

        {sessionEnded && (
          <p
            role="status"
            className="rounded-[10px] border border-rim-line bg-rim-panel-soft px-3 py-2.5 text-[13px] text-rim-text"
          >
            {SESSION_ENDED_MESSAGE}
          </p>
        )}

        {noKeysHere ? (
          <div className="rounded-[14px] border border-rim-line bg-rim-panel-soft p-5">
            <h3 className="mb-2 text-[15px] font-semibold text-rim-text">
              This browser can&apos;t sign in
            </h3>
            <NoKeysHere />
          </div>
        ) : (
          <section aria-label="Sign in with a key" className="space-y-5 empty:hidden">
            <DeviceKeySignIn onSuccess={handleLoginSuccess} />
          </section>
        )}

        <section
          aria-label="Other ways in"
          className="hidden flex-col gap-2 has-[[data-way-in]]:flex"
        >
          <h3 className="mb-0.5 ml-0.5 text-[11px] font-medium uppercase tracking-[0.08em] text-rim-text-muted">
            {hasAccounts ? "Not this account?" : "Choose how to start"}
          </h3>
          {!noKeysHere && <LinkThisDevice onSuccess={handleLoginSuccess} />}
          {!noKeysHere && <RecoverAccount onSuccess={handleLoginSuccess} />}
          {!full && canCreate && (
            <WayInRow
              to="/join"
              title="Create account"
              hint="New here. You need no email."
              icon={<Plus className="h-4 w-4 text-rim-success" />}
            />
          )}
        </section>

        {full ? (
          <RegistrationFullNotice />
        ) : canCreate ? (
          inviteOnly && (
            <p className="text-xs text-rim-text-muted">
              Creating an account here takes an invite code or link from someone on this server.
            </p>
          )
        ) : noKeysHere ? null : isPow ? (
          <p className="text-center text-xs text-rim-text-muted">
            No account? Create one in the RIM desktop app, or ask for an invite.
          </p>
        ) : (
          <p className="text-center text-xs text-rim-text-muted">
            No account? Ask your workspace admin for an invite.
          </p>
        )}

        <footer className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-0.5 pt-1">
          <ServerChoice />
          <AbuseContact />
        </footer>
      </main>
    </div>
  );
}
