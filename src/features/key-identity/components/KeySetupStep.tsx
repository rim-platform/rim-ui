import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { getGraphqlEndpoint } from "../../../core/graphql/config";
import { queryKeys } from "../../../core/query/keys";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { Dialog } from "../../../shared/ui/Dialog";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { e2eeSession, resetE2eeSession } from "../../e2ee/runtime/session";
import { useCurrentUser } from "../../workspaces/api/useCurrentUser";
import { listDeviceKeyAccounts } from "../api/keyIdentity";
import {
  deferKeySetup,
  keySetupDeferred,
  useKeySetupOfferStore,
  type KeySetupKind,
} from "../state/keySetupOffer";
import { EnrollKeyIdentity, type Me } from "./EnrollKeyIdentity";
import { LinkThisDeviceForm } from "./LinkThisDevice";

/**
 * The step this account has on this device: `enroll` when it has no key anywhere and this app
 * can hold an identity key, `link` when it has one elsewhere and this device holds none, `null`
 * otherwise or while unknown.
 */
function useKeySetupKind(): { kind: KeySetupKind | null; me: Me | null } {
  const { capabilities } = useRuntime();
  const { data: user } = useCurrentUser();
  const endpoint = getGraphqlEndpoint();
  const local = useQuery({
    queryKey: queryKeys.deviceKeyAccounts(endpoint),
    queryFn: listDeviceKeyAccounts,
    enabled: capabilities.deviceKeys,
  });
  if (!user || !capabilities.deviceKeys) return { kind: null, me: null };
  const me = {
    userId: user.id,
    username: user.username,
    displayName: user.displayName || user.username,
  };
  if (user.principalId === null) return { kind: capabilities.identityKeys ? "enroll" : null, me };
  if (!user.principalId || !local.data) return { kind: null, me };
  const holdsKey = local.data.some((a) => a.principalId === user.principalId);
  return { kind: holdsKey ? null : "link", me };
}

/**
 * "Set up encryption for this account", offered over the workspace after signing in: an account
 * with no key creates its keys here, an account with keys on another device links this one to
 * them. "Later" holds it back for seven days; `useOfferKeySetup` shows it again sooner.
 */
export function KeySetupStep() {
  const userId = useAuthStore((s) => s.session?.userId ?? null);
  const { platform } = useRuntime();
  const qc = useQueryClient();
  const { kind, me } = useKeySetupKind();
  const requested = useKeySetupOfferStore((s) => s.requested);
  const setAvailable = useKeySetupOfferStore((s) => s.setAvailable);
  const dismiss = useKeySetupOfferStore((s) => s.dismiss);
  // Who chose "Later" in this page, for when the browser cannot store it.
  const [laterFor, setLaterFor] = useState<string | null>(null);
  // Who set up keys in this page: the step stays closed while the queries catch up.
  const [doneFor, setDoneFor] = useState<string | null>(null);

  useEffect(() => {
    setAvailable(kind);
    return () => setAvailable(null);
  }, [kind, setAvailable]);

  if (!userId || !kind || !me || me.userId !== userId) return null;
  const deferred = laterFor === userId || doneFor === userId || keySetupDeferred(userId);
  const open = requested || !deferred;

  function later() {
    if (userId) {
      deferKeySetup(userId);
      setLaterFor(userId);
    }
    dismiss();
  }

  function keysChanged() {
    setDoneFor(userId);
    dismiss();
    void qc.invalidateQueries({ queryKey: queryKeys.deviceKeyAccounts(getGraphqlEndpoint()) });
    // Look for this device's key now rather than when the cached session expires.
    resetE2eeSession();
    void e2eeSession();
  }

  function linked(linkedUserId: string) {
    // A code from another account's device signed this device in as that account.
    if (linkedUserId !== userId) {
      window.location.reload();
      return;
    }
    keysChanged();
  }

  const here = platform === "web" ? "this browser" : "this computer";

  return (
    <Dialog
      open={open}
      onClose={later}
      title="Set up encryption for this account"
      maxWidth="max-w-xl"
    >
      <div className="max-h-[75vh] space-y-4 overflow-y-auto">
        {kind === "enroll" ? (
          <EnrollKeyIdentity
            me={me}
            title="Create your account's keys"
            intro={
              <p>
                Encrypted conversations need a key on every device you use. This creates your
                account&apos;s identity key, its recovery key and a key for {here}.
              </p>
            }
            finishLabel="Set up encryption"
            onEnrolled={keysChanged}
            onLater={later}
          />
        ) : (
          <>
            <p className="text-sm text-rim-text-muted">
              Your account already has keys on another device. Link {here} to them to read and send
              encrypted conversations here; your account keeps its one identity.
            </p>
            <LinkThisDeviceForm
              inBrowser={platform === "web"}
              onSuccess={linked}
              onCancel={later}
              cancelLabel="Later"
            />
          </>
        )}
      </div>
    </Dialog>
  );
}
