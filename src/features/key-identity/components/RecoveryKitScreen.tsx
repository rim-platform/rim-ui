import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { queryKeys } from "../../../core/query/keys";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { Button } from "../../../shared/ui/Button";
import { confirmRecoveryKitSaved, type RecoveryKitText } from "../api/keyIdentity";
import { RecoveryKitView, SecondDeviceNudge } from "./SaveRecoveryKit";

/**
 * The recovery kit of an identity that already exists, which this device keeps until the person
 * confirms saving it: "I saved it" confirms and says so, "Later" closes it and the warning bar
 * stays. `onClose` is called once the person is done with it either way.
 */
export function RecoveryKitScreen({ kit, onClose }: { kit: RecoveryKitText; onClose: () => void }) {
  const { platform } = useRuntime();
  const qc = useQueryClient();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const here = platform === "web" ? "this browser" : "this computer";
  const recheck = () =>
    qc.invalidateQueries({ queryKey: queryKeys.unsavedRecoveryKit(kit.principalId) });

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await confirmRecoveryKitSaved(kit.principalId);
      setSaved(true);
      void recheck();
    } catch (err) {
      setError(graphqlErrorMessage(err, "Could not record that the kit is saved. Try again."));
    } finally {
      setBusy(false);
    }
  }

  function close() {
    void recheck();
    onClose();
  }

  if (saved) {
    return (
      <div className="space-y-4">
        <p role="status" className="text-sm font-medium text-rim-text">
          Recovery kit saved
        </p>
        <p className="text-sm text-rim-text-muted">
          {platform === "web" ? "This browser" : "This computer"} no longer keeps it. If you lose
          every device, the kit gets your account back: on the sign-in screen choose &quot;Recover
          an account&quot;.
        </p>
        <SecondDeviceNudge onOpenSettings={close} />
        <Button onClick={close}>Done</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium text-rim-text">Save your recovery kit</p>
      <p className="text-sm text-rim-text-muted">
        Write down the 12 words in order with your account id, or copy the kit into a password
        manager. Keep it somewhere safe that is not {here}. Anyone who has it can take over your
        account.
      </p>
      <RecoveryKitView kit={kit} />
      <p className="text-xs text-rim-text-faint">
        Until you confirm, {here} keeps the kit and RIM reminds you to save it.
      </p>
      {error && (
        <p role="alert" className="text-sm text-rim-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button onClick={() => void confirm()} isLoading={busy}>
          I saved it
        </Button>
        <Button variant="secondary" onClick={close} disabled={busy}>
          Later
        </Button>
      </div>
      <SecondDeviceNudge onOpenSettings={close} />
    </div>
  );
}
