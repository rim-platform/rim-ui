import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { getGraphqlEndpoint } from "../../../core/graphql/config";
import { queryKeys } from "../../../core/query/keys";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { Dialog } from "../../../shared/ui/Dialog";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { deviceKeysChanged } from "../../e2ee/runtime/session";
import { useCurrentUser } from "../../workspaces/api/useCurrentUser";
import { listDeviceKeyAccounts } from "../api/keyIdentity";
import {
  deferKeySetup,
  keySetupDeferred,
  useKeySetupOfferStore,
  type KeySetupKind,
} from "../state/keySetupOffer";
import { BrowserHistoryNotice } from "./BrowserHistoryNotice";
import { LinkThisDeviceForm } from "./LinkThisDevice";

/**
 * The step this account has on this device: `link` when it has keys elsewhere and this device
 * holds none, `null` otherwise or while unknown; with the account's id.
 */
function useKeySetupKind(): { kind: KeySetupKind | null; userId: string | null } {
  const { capabilities } = useRuntime();
  const { data: user } = useCurrentUser();
  const endpoint = getGraphqlEndpoint();
  const local = useQuery({
    queryKey: queryKeys.deviceKeyAccounts(endpoint),
    queryFn: listDeviceKeyAccounts,
    enabled: capabilities.deviceKeys,
  });
  if (!user || !capabilities.deviceKeys) return { kind: null, userId: null };
  if (!user.principalId || !local.data) return { kind: null, userId: user.id };
  const holdsKey = local.data.some((a) => a.principalId === user.principalId);
  return { kind: holdsKey ? null : "link", userId: user.id };
}

/**
 * "Set up encryption for this account", offered over the workspace after signing in: an account
 * with keys on another device links this one to them. "Later" holds it back for seven days;
 * `useOfferKeySetup` shows it again sooner.
 */
export function KeySetupStep() {
  const userId = useAuthStore((s) => s.session?.userId ?? null);
  const { platform } = useRuntime();
  const qc = useQueryClient();
  const { kind, userId: accountId } = useKeySetupKind();
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

  if (!userId || !kind || accountId !== userId) return null;
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
    // Set this device up for encryption now rather than when the cached session expires.
    deviceKeysChanged();
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
        <BrowserHistoryNotice />
      </div>
    </Dialog>
  );
}
