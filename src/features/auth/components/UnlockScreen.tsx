import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { getGraphqlEndpoint } from "../../../core/graphql/config";
import { logger } from "../../../core/logger";
import { Button } from "../../../shared/ui/Button";
import { signOut } from "../runtime/signOut";
import { principalOf } from "../runtime/unlockGate";
import { useAuthStore } from "../state/useAuthStore";
import { PasswordSignInForm } from "./PasswordSignIn";

/**
 * Shown instead of the app while the signed-in account is locked on this device: its data opens
 * only with its password, which signs in again through the same steps as the sign-in screen.
 * Signing out leads back to sign-in.
 */
export function UnlockScreen() {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.session?.userId ?? null);
  const [leaving, setLeaving] = useState(false);
  // `undefined` while this device's keys are read; `null` when it holds none for the account.
  const [principalId, setPrincipalId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    principalOf(getGraphqlEndpoint(), userId)
      .catch((err: unknown) => {
        logger.warn("[RIM:auth] this device's keys could not be read:", err);
        return null;
      })
      .then((found) => {
        if (!cancelled) setPrincipalId(found);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const signOutButton = (
    <Button
      variant="secondary"
      isLoading={leaving}
      onClick={() => {
        setLeaving(true);
        void signOut(queryClient).finally(() => setLeaving(false));
      }}
    >
      Sign out
    </Button>
  );

  return (
    <div role="alert" className="mx-auto flex w-full max-w-sm flex-col gap-4 p-6">
      <h1 className="text-center text-lg font-semibold text-rim-text">This account is locked</h1>
      {principalId ? (
        <>
          <p className="text-center text-sm text-rim-text-muted">
            What this device keeps for the account opens only with its password.
          </p>
          <PasswordSignInForm
            principalId={principalId}
            accountLabel="this account"
            submitLabel="Unlock"
            onSignedIn={() => undefined}
          />
        </>
      ) : (
        principalId === null && (
          <p className="text-center text-sm text-rim-text-muted">
            This device holds no keys for the account, so it cannot unlock it here. Sign out, then
            sign in by linking this device or with the recovery kit.
          </p>
        )
      )}
      <div className="flex justify-center">{signOutButton}</div>
    </div>
  );
}
