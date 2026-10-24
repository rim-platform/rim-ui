import { useState } from "react";

import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { Button } from "../../../shared/ui/Button";
import {
  EMPTY_NEW_PASSWORD,
  newPasswordProblem,
  PASSWORD_CHANGED_MESSAGE,
  signInFailure,
} from "../password";
import { WrongPasswordError } from "../api/passwordApi";
import { changePassword } from "../runtime/passwordChanges";
import { NewPasswordFields, PasswordInput } from "./PasswordFields";

/**
 * Settings > Security > "Password": change the account password with the current one. The new
 * one is a PIN or a passphrase, typed twice. Other sessions of the account end.
 */
export function ChangePassword({ principalId }: { principalId: string }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState(EMPTY_NEW_PASSWORD);
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);

  function reset() {
    setCurrent("");
    setNext(EMPTY_NEW_PASSWORD);
    setProblem(null);
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const nextProblem = newPasswordProblem(next);
    setProblem(nextProblem);
    if (nextProblem) return;
    setBusy(true);
    try {
      await changePassword(principalId, current, next.password);
      reset();
      setOpen(false);
      setChanged(true);
    } catch (err) {
      setCurrent("");
      setError(
        err instanceof WrongPasswordError
          ? "The current password is wrong."
          : (signInFailure(err) ?? graphqlErrorMessage(err, "The password was not changed.")),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-lg border border-rim-line bg-rim-panel p-4">
      <p className="text-sm font-medium text-rim-text">Password</p>
      <p className="text-xs text-rim-text-muted">
        Your password signs you in together with this device&apos;s key, and what this device keeps
        for your account is encrypted under it. Changing it signs out your other sessions.
      </p>
      {changed && !open && (
        <p role="status" className="text-xs text-rim-success">
          Password changed. {PASSWORD_CHANGED_MESSAGE}
        </p>
      )}
      {open ? (
        <form onSubmit={(e) => void submit(e)} className="space-y-3">
          <PasswordInput
            label="Current password"
            value={current}
            onChange={setCurrent}
            disabled={busy}
            autoFocus
          />
          <NewPasswordFields
            label="New password"
            value={next}
            onChange={(value) => {
              setNext(value);
              setProblem(null);
            }}
            problem={problem}
            disabled={busy}
          />
          {error && (
            <p role="alert" className="text-xs text-rim-danger">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" size="sm" isLoading={busy} disabled={!current || !next.password}>
              Change password
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                reset();
                setOpen(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setChanged(false);
            setOpen(true);
          }}
        >
          Change password
        </Button>
      )}
    </section>
  );
}
