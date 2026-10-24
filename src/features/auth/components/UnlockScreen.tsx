import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "../../../shared/ui/Button";
import { signOut } from "../runtime/signOut";

/**
 * Shown instead of the app while the signed-in account is locked on this device: its data opens
 * only with its password. Signing out leads back to sign-in.
 */
export function UnlockScreen() {
  const queryClient = useQueryClient();
  const [leaving, setLeaving] = useState(false);

  return (
    <div role="alert" className="mx-auto flex max-w-sm flex-col items-center gap-4 p-6 text-center">
      <h1 className="text-lg font-semibold text-rim-text">This account is locked</h1>
      <p className="text-sm text-rim-text-muted">
        What this device keeps for the account opens only with its password. Sign in again to unlock
        it.
      </p>
      <Button
        isLoading={leaving}
        onClick={() => {
          setLeaving(true);
          void signOut(queryClient).finally(() => setLeaving(false));
        }}
      >
        Sign out
      </Button>
    </div>
  );
}
