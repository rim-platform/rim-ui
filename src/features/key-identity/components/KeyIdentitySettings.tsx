import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";

import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { queryKeys } from "../../../core/query/keys";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { Button } from "../../../shared/ui/Button";
import { useCurrentUser } from "../../workspaces/api/useCurrentUser";
import {
  abandonEnrollment,
  beginEnrollment,
  completeEnrollment,
  defaultDeviceName,
  fetchMyKeyIdentity,
  profileCardIsStale,
  publishProfileCard,
  reconcileDeviceKeys,
  revokeDevice,
  rotateIdentityKey,
  settleDeviceKeys,
  syncKeyLog,
  type EnrollmentDraft,
  type KeyAccount,
  type MyKeyIdentity,
} from "../api/keyIdentity";
import { SaveRecoveryKit } from "./SaveRecoveryKit";
import { LinkDevicePanel } from "./LinkDevicePanel";

const inputClass =
  "mt-2 w-full rounded-md border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none placeholder:text-rim-text-faint focus:border-rim-accent/40";

interface Me extends KeyAccount {
  displayName: string;
}

function errorText(err: unknown, fallback: string): string {
  return graphqlErrorMessage(err, fallback);
}

function formatDate(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString() : "never";
}

/**
 * Settings > Security: sign in with this device's key instead of a password (key identity,
 * master plan Stage 3). Setting it up, the account's devices, identity key rotation and the
 * profile card live here; the keys themselves stay on the desktop's Tauri side.
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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-rim-text">Security</h2>
        <p className="mt-1 text-sm text-rim-text-muted">
          Sign in with a key kept on this computer instead of a password. Your account gets a
          permanent account id that stays the same when keys change, and a recovery kit gets it back
          if every device is lost.
        </p>
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
          canSign={capabilities.deviceKeys}
        />
      ) : capabilities.deviceKeys ? (
        <EnrollKeyIdentity me={me} />
      ) : (
        <p className="text-sm text-rim-text-muted">Key sign-in is set up from the desktop app.</p>
      )}
    </div>
  );
}

// ─── Enrollment ─────────────────────────────────────────────────────────────

type EnrollStep = "intro" | "kit" | "done";

function EnrollKeyIdentity({ me }: { me: Me }) {
  const qc = useQueryClient();
  const [step, setStep] = useState<EnrollStep>("intro");
  const [deviceName, setDeviceName] = useState("");
  const [draft, setDraft] = useState<EnrollmentDraft | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The draft to give up on if the panel closes before the enrollment finishes.
  const pending = useRef<EnrollmentDraft | null>(null);
  const meRef = useRef(me);
  useEffect(() => {
    meRef.current = me;
  }, [me]);

  useEffect(() => {
    let cancelled = false;
    void defaultDeviceName().then((name) => {
      if (!cancelled) setDeviceName((current) => current || name);
    });
    // Keys left by an enrollment the server never accepted (the app quit mid-way).
    void reconcileDeviceKeys(meRef.current).catch(() => undefined);
    return () => {
      cancelled = true;
      if (pending.current) void abandonEnrollment(pending.current, meRef.current);
    };
  }, []);

  async function createKeys() {
    setBusy(true);
    setError(null);
    try {
      const next = await beginEnrollment(deviceName);
      pending.current = next;
      setDraft(next);
      setStep("kit");
    } catch (err) {
      setError(errorText(err, "Could not create the keys."));
    } finally {
      setBusy(false);
    }
  }

  async function enroll() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      await completeEnrollment(draft, me);
      pending.current = null;
      // The kit is saved and the keys are enrolled: the phrase leaves memory here.
      setDraft(null);
      setStep("done");
      void qc.invalidateQueries({ queryKey: queryKeys.me });
      void qc.invalidateQueries({ queryKey: queryKeys.myKeyIdentity });
    } catch (err) {
      // The draft stays: trying again uses the same keys, so the saved kit stays valid.
      setError(errorText(err, "The server did not accept the keys."));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    const current = pending.current;
    pending.current = null;
    setDraft(null);
    setSaved(false);
    setStep("intro");
    if (current) await abandonEnrollment(current, me);
  }

  if (step === "done") {
    return <p className="text-sm text-rim-text-muted">Key sign-in is on. Loading your keys...</p>;
  }

  if (step === "intro") {
    return (
      <div className="space-y-4 rounded-lg border border-rim-line bg-rim-panel p-4">
        <div className="flex items-start gap-3">
          <KeyRound className="mt-0.5 h-5 w-5 text-rim-accent" />
          <div className="space-y-2 text-sm text-rim-text-muted">
            <p className="font-medium text-rim-text">Set up key sign-in</p>
            <p>Before you start, know what changes:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Your password stops working, here and in the web app.</li>
              <li>
                This computer signs in with its key. Other desktops get keys of their own when you
                link them from here; until then, they stay signed in only until their session ends.
              </li>
              <li>
                You get a recovery kit, shown once. Without it, losing this computer means losing
                the account.
              </li>
            </ul>
          </div>
        </div>
        <label className="block text-sm font-medium text-rim-text">
          Name of this device
          <input
            value={deviceName}
            maxLength={64}
            onChange={(e) => setDeviceName(e.target.value)}
            className={inputClass}
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-rim-danger">
            {error}
          </p>
        )}
        <Button onClick={() => void createKeys()} isLoading={busy} disabled={!deviceName.trim()}>
          Create keys
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border border-rim-line bg-rim-panel p-4">
      {draft && <SaveRecoveryKit draft={draft} saved={saved} onSavedChange={setSaved} />}
      {error && (
        <p role="alert" className="text-sm text-rim-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button onClick={() => void enroll()} isLoading={busy} disabled={!saved}>
          Turn on key sign-in
        </Button>
        <Button variant="secondary" onClick={() => void cancel()} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ─── An enrolled account ────────────────────────────────────────────────────

function KeyIdentityOverview({
  identity,
  principalId,
  me,
  canSign,
}: {
  identity: MyKeyIdentity;
  principalId: string;
  me: Me;
  canSign: boolean;
}) {
  const qc = useQueryClient();
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

  // Keep the profile card in step with the name, the devices and the identity key.
  const cardStale = holdsIdentityKey && profileCardIsStale(identity, me.displayName);
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
              ? "Checking this computer's keys..."
              : !local.data?.deviceId
                ? "This computer holds no key for this account. It stays signed in until its session ends."
                : holdsIdentityKey
                  ? "This computer holds the account's identity key, so it can manage devices."
                  : "This computer signs in with its own key. Devices are managed from the computer that holds the identity key."}
        </p>
        {local.error && (
          <p role="alert" className="mt-2 text-xs text-rim-danger">
            {errorText(local.error, "Could not check this computer's keys.")}
          </p>
        )}
      </div>

      <section className="rounded-lg border border-rim-line bg-rim-panel p-4">
        <p className="text-sm font-medium text-rim-text">Devices</p>
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
                  void run(
                    () => revokeDevice(identity, confirm.deviceId),
                    "Could not remove the device.",
                  )
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
      </section>

      {holdsIdentityKey && <LinkDevicePanel identity={identity} displayName={me.displayName} />}

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
        </section>
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
