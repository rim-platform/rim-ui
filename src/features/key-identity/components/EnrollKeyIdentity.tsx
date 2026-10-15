import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";

import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { queryKeys } from "../../../core/query/keys";
import { Button } from "../../../shared/ui/Button";
import {
  abandonEnrollment,
  beginEnrollment,
  completeEnrollment,
  defaultDeviceName,
  reconcileDeviceKeys,
  type EnrollmentDraft,
  type KeyAccount,
} from "../api/keyIdentity";
import { SaveRecoveryKit } from "./SaveRecoveryKit";

const inputClass =
  "mt-2 w-full rounded-md border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none placeholder:text-rim-text-faint focus:border-rim-accent/40";

/** The signed-in account, with the name its profile card shows. */
export interface Me extends KeyAccount {
  displayName: string;
}

type EnrollStep = "intro" | "kit" | "done";

/**
 * Enroll the signed-in account: what changes, the device name, the keys, the recovery kit shown
 * once, and the enrollment once the person saved it. `onLater` adds a "Later" button to the
 * first screen.
 */
export function EnrollKeyIdentity({
  me,
  onEnrolled,
  title = "Set up key sign-in",
  intro,
  finishLabel = "Turn on key sign-in",
  onLater,
}: {
  me: Me;
  onEnrolled: () => void;
  title?: string;
  intro?: ReactNode;
  finishLabel?: string;
  onLater?: () => void;
}) {
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
      setError(graphqlErrorMessage(err, "Could not create the keys."));
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
      onEnrolled();
      void qc.invalidateQueries({ queryKey: queryKeys.me });
      void qc.invalidateQueries({ queryKey: queryKeys.myKeyIdentity });
    } catch (err) {
      // The draft stays: trying again uses the same keys, so the saved kit stays valid.
      setError(graphqlErrorMessage(err, "The server did not accept the keys."));
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
            <p className="font-medium text-rim-text">{title}</p>
            {intro}
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
        <div className="flex gap-2">
          <Button onClick={() => void createKeys()} isLoading={busy} disabled={!deviceName.trim()}>
            Create keys
          </Button>
          {onLater && (
            <Button variant="secondary" onClick={onLater} disabled={busy}>
              Later
            </Button>
          )}
        </div>
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
          {finishLabel}
        </Button>
        <Button variant="secondary" onClick={() => void cancel()} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
