import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isTauri } from "@tauri-apps/api/core";

import { getGraphqlEndpoint } from "../../../core/graphql/config";
import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { logger } from "../../../core/logger";
import { Button } from "../../../shared/ui/Button";
import { EMPTY_NEW_PASSWORD, keepSignedInByDefault, newPasswordProblem } from "../password";
import { setFirstPassword } from "../runtime/passwordChanges";
import { signOut } from "../runtime/signOut";
import { principalOf } from "../runtime/unlockGate";
import { useAuthStore } from "../state/useAuthStore";
import { KeepSignedInCheckbox, NewPasswordFields } from "./PasswordFields";

/**
 * The only screen of a session whose account has no password yet: the person sets one, which
 * also unlocks the account on this device, or signs out. The server refuses everything else
 * until a password is set.
 */
export function SetPasswordScreen() {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.session?.userId ?? null);
  const [principalId, setPrincipalId] = useState<string | null | undefined>(undefined);
  const [next, setNext] = useState(EMPTY_NEW_PASSWORD);
  const [keep, setKeep] = useState(() => keepSignedInByDefault(isTauri()));
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);

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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!principalId) return;
    setError(null);
    const nextProblem = newPasswordProblem(next);
    setProblem(nextProblem);
    if (nextProblem) return;
    setBusy(true);
    try {
      await setFirstPassword(principalId, next.password, keep);
      useAuthStore.getState().setMustSetPassword(false);
    } catch (err) {
      setError(graphqlErrorMessage(err, "The password could not be set."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="mx-auto flex w-full max-w-sm flex-col gap-4 p-6"
    >
      <h1 className="text-center text-lg font-semibold text-rim-text">Set a password</h1>
      <p className="text-center text-sm text-rim-text-muted">
        This account has no password yet. Set one to keep using it: what this device keeps for the
        account is encrypted under it.
      </p>
      {principalId === null ? (
        <p role="alert" className="text-sm text-rim-danger">
          This device holds no keys for the account, so it cannot set its password. Sign out and
          sign in on a device that holds them.
        </p>
      ) : (
        <>
          <NewPasswordFields
            value={next}
            onChange={(value) => {
              setNext(value);
              setProblem(null);
            }}
            problem={problem}
            disabled={busy}
          />
          <KeepSignedInCheckbox checked={keep} onChange={setKeep} disabled={busy} />
        </>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger"
        >
          {error}
        </p>
      )}
      <div className="flex justify-center gap-2">
        {principalId && (
          <Button type="submit" isLoading={busy} disabled={!next.password}>
            Set password
          </Button>
        )}
        <Button
          type="button"
          variant="secondary"
          isLoading={leaving}
          disabled={busy}
          onClick={() => {
            setLeaving(true);
            void signOut(queryClient).finally(() => setLeaving(false));
          }}
        >
          Sign out
        </Button>
      </div>
    </form>
  );
}
