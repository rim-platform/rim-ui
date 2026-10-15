import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";

import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { queryKeys } from "../../../core/query/keys";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { Button } from "../../../shared/ui/Button";
import {
  abandonEnrollment,
  beginEnrollment,
  completeEnrollment,
  defaultDeviceName,
  deviceKeepsRecoveryKit,
  reconcileDeviceKeys,
  type EnrollmentDraft,
  type KeyAccount,
} from "../api/keyIdentity";
import { RecoveryKitScreen } from "./RecoveryKitScreen";
import { SaveRecoveryKit } from "./SaveRecoveryKit";
import { useKeyStorageConsent } from "./useKeyStorageConsent";

const inputClass =
  "mt-2 w-full rounded-md border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none placeholder:text-rim-text-faint focus:border-rim-accent/40";

/** The signed-in account, with the name its profile card shows. */
export interface Me extends KeyAccount {
  displayName: string;
}

/** `kit` saves the kit before enrolling; `savedLater` shows it after, where the device keeps it. */
type EnrollStep = "intro" | "kit" | "savedLater" | "done";

/**
 * Enroll the signed-in account: what changes, the device name, the keys and the recovery kit.
 * Where this device keeps the kit until it is confirmed, the account is enrolled first and the
 * kit shown after; elsewhere the kit is shown once and the enrollment sent when the person saved
 * it. Before any key is made the browser is asked to keep this site's data, and a refusal needs
 * the person's go-ahead. `onLater` adds a "Later" button to the first screen.
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
  const { platform } = useRuntime();
  // Read once: the panel follows one flow from start to end.
  const [kitAfter] = useState(deviceKeepsRecoveryKit);
  const storage = useKeyStorageConsent();
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
  // Set while the account is enrolled and its kit still on screen; runs `finished` if the panel
  // closes first.
  const enrolledUnfinished = useRef<(() => void) | null>(null);

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
      enrolledUnfinished.current?.();
    };
  }, []);

  /** The keys are enrolled and the kit dealt with: the phrase leaves memory here. */
  function finished() {
    enrolledUnfinished.current = null;
    setDraft(null);
    setStep("done");
    onEnrolled();
    void qc.invalidateQueries({ queryKey: queryKeys.me });
    void qc.invalidateQueries({ queryKey: queryKeys.myKeyIdentity });
  }

  /** Enroll with `current`; where the kit is shown after, show it, else finish. */
  async function send(current: EnrollmentDraft) {
    try {
      await completeEnrollment(current, me, kitAfter ? "later" : "saved");
      pending.current = null;
      if (kitAfter) {
        enrolledUnfinished.current = finished;
        setStep("savedLater");
      } else {
        finished();
      }
    } catch (err) {
      // The draft stays: trying again uses the same keys, so a saved kit stays valid.
      setError(graphqlErrorMessage(err, "The server did not accept the keys."));
    }
  }

  async function createKeys() {
    setBusy(true);
    setError(null);
    try {
      // A retry after a refusal uses the keys already made.
      if (pending.current && kitAfter) {
        await send(pending.current);
        return;
      }
      if (!(await storage.ensure())) return;
      let next: EnrollmentDraft;
      try {
        next = await beginEnrollment(deviceName);
      } catch (err) {
        setError(graphqlErrorMessage(err, "Could not create the keys."));
        return;
      }
      pending.current = next;
      setDraft(next);
      if (kitAfter) await send(next);
      else setStep("kit");
    } finally {
      setBusy(false);
    }
  }

  async function enroll() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      await send(draft);
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

  const here = platform === "web" ? "this browser" : "this computer";
  const Here = platform === "web" ? "This browser" : "This computer";

  if (step === "savedLater" && draft) {
    return (
      <div className="space-y-4 rounded-lg border border-rim-line bg-rim-panel p-4">
        <p className="text-sm text-rim-text-muted">Key sign-in is on.</p>
        <RecoveryKitScreen kit={draft} onClose={finished} />
      </div>
    );
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
                {Here} signs in with its key. Other devices get keys of their own when you link them
                from here. Other sessions of this account are signed out.
              </li>
              <li>
                {kitAfter
                  ? `You get a recovery kit to save. Without it, losing ${here} means losing the account.`
                  : `You get a recovery kit, shown once. Without it, losing ${here} means losing the account.`}
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
        {storage.prompt}
        <div className="flex gap-2">
          <Button onClick={() => void createKeys()} isLoading={busy} disabled={!deviceName.trim()}>
            {kitAfter ? finishLabel : "Create keys"}
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
