import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { queryKeys } from "../../../core/query/keys";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { Button } from "../../../shared/ui/Button";
import { deviceKeysChanged } from "../../e2ee/runtime/session";
import { useCurrentUser } from "../../workspaces/api/useCurrentUser";
import { RevocationFanoutPanel } from "../../relay/components/RevocationFanoutPanel";
import { followRevocation } from "../../relay/remote/useRevocationStore";
import { RelaySpacesSettings } from "../../relay/components/RelaySpacesSettings";
import { RelaySwitchPanel } from "../../relay/components/RelaySwitchPanel";
import { useRelaySwitchStore } from "../../relay/remote/relaySwitchLive";
import { useServerOrigin } from "../../relay/state/serverOrigin";
import { LimitNote } from "../../limits/components/LimitNote";
import { limitView } from "../../limits/limits";
import { useServerInfo } from "../../updater/hooks/useServerInfo";
import {
  fetchMyKeyIdentity,
  profileCardIsStale,
  publishProfileCard,
  revokeDevice,
  rotateIdentityKey,
  settleDeviceKeys,
  syncKeyLog,
  type MyKeyIdentity,
} from "../api/keyIdentity";
import { BrowserHistoryNotice } from "./BrowserHistoryNotice";
import { CardRelays } from "./CardRelays";
import { IdentityKeyBackup } from "./IdentityKeyBackup";
import { EnrollKeyIdentity, type Me } from "./EnrollKeyIdentity";
import { LinkDevicePanel } from "./LinkDevicePanel";

function errorText(err: unknown, fallback: string): string {
  return graphqlErrorMessage(err, fallback);
}

function formatDate(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString() : "never";
}

/**
 * Settings > Security: sign in with this device's key instead of a password. Setting it up,
 * the account's devices, identity key rotation and the profile card live here; the keys
 * themselves stay with the key backend (the desktop's Tauri side, or the browser's key store).
 */
export function KeyIdentitySettings() {
  const { capabilities } = useRuntime();
  const { data: user } = useCurrentUser();
  const identity = useQuery({
    queryKey: queryKeys.myKeyIdentity,
    queryFn: fetchMyKeyIdentity,
    retry: false,
  });
  const me: Me | null = user
    ? { userId: user.id, username: user.username, displayName: user.displayName || user.username }
    : null;
  // Set when this panel enrolled the account, so the overview that replaces the enrollment
  // says the other sessions were signed out.
  const [justEnrolled, setJustEnrolled] = useState(false);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-rim-text">Security</h2>
        <p className="mt-1 text-sm text-rim-text-muted">
          Sign in with a key kept on this device instead of a password. Your account gets a
          permanent account id that stays the same when keys change, and a recovery kit gets it back
          if every device is lost.
        </p>
        <BrowserHistoryNotice className="mt-2" />
      </div>

      {identity.error ? (
        <p role="alert" className="text-sm text-rim-danger">
          {errorText(identity.error, "Could not load your keys.")}
        </p>
      ) : !identity.data || !me ? (
        <p className="text-sm text-rim-text-muted">Loading...</p>
      ) : identity.data.principalId ? (
        <KeyIdentityOverview
          identity={identity.data}
          principalId={identity.data.principalId}
          me={me}
          canSign={capabilities.identityKeys}
          canBackUp={capabilities.identityBackup}
          justEnrolled={justEnrolled}
        />
      ) : capabilities.identityKeys ? (
        <EnrollKeyIdentity
          me={me}
          onEnrolled={() => {
            setJustEnrolled(true);
            deviceKeysChanged();
          }}
        />
      ) : (
        <p className="text-sm text-rim-text-muted">Key sign-in is set up from the desktop app.</p>
      )}
    </div>
  );
}

// ─── An enrolled account ────────────────────────────────────────────────────

function KeyIdentityOverview({
  identity,
  principalId,
  me,
  canSign,
  canBackUp,
  justEnrolled,
}: {
  identity: MyKeyIdentity;
  principalId: string;
  me: Me;
  canSign: boolean;
  /** The identity key backup in the history archive is offered here. */
  canBackUp: boolean;
  justEnrolled: boolean;
}) {
  const qc = useQueryClient();
  const here = useRuntime().platform === "web" ? "browser" : "computer";
  const local = useQuery({
    queryKey: queryKeys.deviceKeyStatus(principalId, identity.keySeq),
    enabled: canSign,
    retry: false,
    queryFn: async () => {
      const status = await syncKeyLog(identity);
      const keys = await settleDeviceKeys(me, principalId);
      return { holdsIdentityKey: status?.holdsIdentityKey ?? false, deviceId: keys?.deviceId };
    },
  });
  const holdsIdentityKey = local.data?.holdsIdentityKey ?? false;
  const [confirm, setConfirm] = useState<
    { kind: "revoke"; deviceId: string } | { kind: "rotate" } | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cardError, setCardError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: queryKeys.myKeyIdentity });
  const deviceLimit = limitView(
    useServerInfo().limits?.devicesPerUser,
    identity.devices.filter((d) => !d.revokedAt).length,
    ["device", "devices"],
    "devices per user",
  );

  // Keep the profile card in step with the name, the devices and the identity key; a relay
  // switch publishes its own cards.
  const switching = useRelaySwitchStore((s) => s.running || (s.state?.step ?? 0) >= 5);
  const ownOrigin = useServerOrigin().origin;
  const cardStale =
    holdsIdentityKey &&
    !switching &&
    ownOrigin !== null &&
    profileCardIsStale(identity, me.displayName, ownOrigin);
  const cardAttempt = useRef<string | null>(null);
  useEffect(() => {
    if (!cardStale) return;
    const attempt = `${identity.keySeq}:${identity.devices.length}:${me.displayName}`;
    if (cardAttempt.current === attempt) return;
    cardAttempt.current = attempt;
    publishProfileCard(identity, me.displayName)
      .then(() => {
        setCardError(null);
        void refresh();
      })
      .catch((err: unknown) => setCardError(errorText(err, "Could not publish the profile card.")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardStale, identity, me.displayName]);

  async function run(action: () => Promise<void>, fallback: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setConfirm(null);
    } catch (err) {
      setError(errorText(err, fallback));
    } finally {
      // Also after a failure: an answer that was lost may hide a change that landed, and a
      // retry must sign against the server's current log.
      await refresh().catch(() => undefined);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-rim-line bg-rim-panel p-4">
        <p className="text-sm font-medium text-rim-text">Key sign-in is on</p>
        <p className="mt-1 text-xs text-rim-text-muted">Your account id</p>
        <code className="mt-1 block select-all break-all font-mono text-xs text-rim-text">
          {principalId}
        </code>
        <p className="mt-3 text-xs text-rim-text-muted">
          {!canSign
            ? "This app has no keys of its own. Manage keys from the desktop app that holds them."
            : local.isPending
              ? `Checking this ${here}'s keys...`
              : !local.data?.deviceId
                ? `This ${here} holds no key for this account. It stays signed in until its session ends.`
                : holdsIdentityKey
                  ? `This ${here} holds the account's identity key, so it can manage devices.`
                  : "This device signs in with its own key. Devices are managed from the device that holds the identity key."}
        </p>
        {local.error && (
          <p role="alert" className="mt-2 text-xs text-rim-danger">
            {errorText(local.error, `Could not check this ${here}'s keys.`)}
          </p>
        )}
        {justEnrolled && (
          <p
            role="status"
            className="mt-4 border-t border-rim-line pt-4 text-xs text-rim-text-muted"
          >
            Every other session of your account was signed out, so from now on only your keys get
            in.
          </p>
        )}
      </div>

      <section className="rounded-lg border border-rim-line bg-rim-panel p-4">
        <p className="text-sm font-medium text-rim-text">Devices</p>
        <LimitNote limit={deviceLimit} className="mt-1" />
        <ul className="mt-2 divide-y divide-rim-line">
          {identity.devices.map((device) => {
            const isThis = device.deviceId === local.data?.deviceId;
            return (
              <li key={device.deviceId} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-rim-text">
                    {device.name}
                    {isThis && <span className="ml-2 text-xs text-rim-accent">this device</span>}
                    {device.revokedAt && (
                      <span className="ml-2 text-xs text-rim-text-faint">removed</span>
                    )}
                  </p>
                  <p className="text-xs text-rim-text-faint">
                    Added {formatDate(device.addedAt)} · last sign-in{" "}
                    {formatDate(device.lastUsedAt)}
                  </p>
                </div>
                {!device.revokedAt && !isThis && holdsIdentityKey && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => setConfirm({ kind: "revoke", deviceId: device.deviceId })}
                  >
                    Remove
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        {confirm?.kind === "revoke" && (
          <div className="mt-3 space-y-2 rounded-md border border-rim-danger/30 bg-rim-danger/10 p-3">
            <p className="text-sm text-rim-text">
              Remove this device? It is signed out now and can never sign in with its key again.
            </p>
            <div className="flex gap-2">
              <Button
                variant="danger"
                size="sm"
                isLoading={busy}
                onClick={() =>
                  void run(async () => {
                    const revocation = await revokeDevice(identity, confirm.deviceId);
                    await followRevocation(confirm.deviceId, revocation).catch(() => undefined);
                  }, "Could not remove the device.")
                }
              >
                Remove device
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setConfirm(null)}>
                Keep it
              </Button>
            </div>
          </div>
        )}
        <RevocationFanoutPanel />
      </section>

      <RelaySpacesSettings />

      {holdsIdentityKey && <RelaySwitchPanel identity={identity} displayName={me.displayName} />}

      {holdsIdentityKey && (
        <LinkDevicePanel
          identity={identity}
          displayName={me.displayName}
          full={deviceLimit?.full ? "Remove a device to link another." : null}
        />
      )}

      {holdsIdentityKey && (
        <section className="space-y-2 rounded-lg border border-rim-line bg-rim-panel p-4">
          <p className="text-sm font-medium text-rim-text">Identity key</p>
          <p className="text-xs text-rim-text-muted">
            Replace the identity key if you think someone copied it. Your account id, your recovery
            kit and your devices stay the same.
          </p>
          {confirm?.kind === "rotate" ? (
            <div className="flex gap-2">
              <Button
                size="sm"
                isLoading={busy}
                onClick={() =>
                  void run(() => rotateIdentityKey(identity), "Could not replace the identity key.")
                }
              >
                Replace identity key
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => setConfirm({ kind: "rotate" })}
            >
              Replace identity key...
            </Button>
          )}
          <p className="text-xs text-rim-text-faint">
            Profile card:{" "}
            {identity.profileCard
              ? `version ${identity.profileCard.version}, published ${formatDate(identity.profileCard.updatedAt)}`
              : "not published yet"}
          </p>
          {cardError && (
            <p role="alert" className="text-xs text-rim-danger">
              {cardError}
            </p>
          )}
          <CardRelays
            key={identity.profileCard?.version ?? 0}
            identity={identity}
            displayName={me.displayName}
            onPublished={() => void refresh()}
          />
        </section>
      )}

      {canBackUp && canSign && local.data?.deviceId && (
        <IdentityKeyBackup
          identity={identity}
          principalId={principalId}
          holdsIdentityKey={holdsIdentityKey}
        />
      )}

      {error && (
        <p role="alert" className="text-sm text-rim-danger">
          {error}
        </p>
      )}

      <p className="text-xs text-rim-text-faint">
        Keep your recovery kit safe. If you lose every device, it is the only way back in: on the
        sign-in screen choose &quot;Recover an account&quot;.
      </p>
    </div>
  );
}
