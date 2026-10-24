import { useCallback, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";

import {
  graphqlErrorCode,
  graphqlErrorMessage,
  UNAUTHENTICATED,
} from "../../../core/graphql/errors";
import { Button } from "../../../shared/ui/Button";
import {
  signInWithPassword,
  type PasswordSignInResult,
  type RecoveryChoice,
} from "../../key-identity/api/keyIdentity";
import { PasswordLockedError } from "../api/passwordApi";
import {
  EMPTY_NEW_PASSWORD,
  keepSignedInByDefault,
  newPasswordProblem,
  NEEDS_RECOVERY_EXPLANATION,
  readPhrase,
  signInFailure,
  START_EMPTY_EXPLANATION,
} from "../password";
import { resetPassword } from "../runtime/passwordChanges";
import { KeepSignedInCheckbox, NewPasswordFields, PasswordInput } from "./PasswordFields";

const textareaClass =
  "mt-1 w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2.5 font-mono text-sm normal-case tracking-normal text-rim-text outline-none transition placeholder:text-rim-text-faint focus:border-rim-accent/40";

const labelClass = "block text-xs font-medium uppercase tracking-wider text-rim-text-faint";

/** The question a sign-in asks when this device's data needs the recovery phrase. */
interface RecoveryQuestion {
  wrongPhrase: boolean;
  answer: (choice: RecoveryChoice | null) => void;
}

/**
 * Asks for the recovery phrase, or to start empty, while a sign-in waits: `onNeedsRecovery`
 * goes to the sign-in, and `prompt` renders the question while one is open.
 */
function useRecoveryQuestion() {
  const [question, setQuestion] = useState<RecoveryQuestion | null>(null);

  const onNeedsRecovery = useCallback(
    (wrongPhrase: boolean) =>
      new Promise<RecoveryChoice | null>((resolve) => {
        setQuestion({
          wrongPhrase,
          answer: (choice) => {
            setQuestion(null);
            resolve(choice);
          },
        });
      }),
    [],
  );

  const prompt = question ? (
    <RecoveryNeeded wrongPhrase={question.wrongPhrase} onChoose={question.answer} />
  ) : null;
  return { onNeedsRecovery, prompt };
}

/**
 * This device's data for the account needs the recovery phrase: unlock it with the phrase, or
 * start empty on this device after reading what that loses.
 */
function RecoveryNeeded({
  wrongPhrase,
  onChoose,
}: {
  wrongPhrase: boolean;
  onChoose: (choice: RecoveryChoice | null) => void;
}) {
  const [phrase, setPhrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);

  async function unlock() {
    const read = await readPhrase(phrase);
    if ("error" in read) {
      setError(read.error);
      return;
    }
    onChoose({ entropy: read.entropy });
  }

  if (confirmEmpty) {
    return (
      <div role="alertdialog" className="space-y-2 rounded-lg border border-rim-warm/30 p-3">
        <p className="text-sm font-medium text-rim-text">Start empty on this device?</p>
        <p className="text-xs text-rim-text-muted">{START_EMPTY_EXPLANATION}</p>
        <div className="flex gap-2">
          <Button size="sm" variant="danger" onClick={() => onChoose("startEmpty")}>
            Start empty
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setConfirmEmpty(false)}>
            Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div role="alertdialog" className="space-y-2 rounded-lg border border-rim-line p-3">
      <p className="text-sm font-medium text-rim-text">Your recovery phrase is needed</p>
      <p className="text-xs text-rim-text-muted">{NEEDS_RECOVERY_EXPLANATION}</p>
      {wrongPhrase && (
        <p role="alert" className="text-xs text-rim-danger">
          That phrase does not open what this device keeps. Check it, or start empty.
        </p>
      )}
      <label className={labelClass}>
        Recovery phrase
        <textarea
          value={phrase}
          onChange={(e) => {
            setPhrase(e.target.value);
            setError(null);
          }}
          rows={3}
          spellCheck={false}
          placeholder="12 words"
          className={textareaClass}
        />
      </label>
      {error && <p className="text-xs text-rim-danger">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void unlock()} disabled={!phrase.trim()}>
          Unlock with the phrase
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setConfirmEmpty(true)}>
          Start empty on this device
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onChoose(null)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

interface PasswordSignInFormProps {
  principalId: string;
  /** The account as the person knows it, for the heading. */
  accountLabel: string;
  submitLabel?: string;
  onSignedIn: (result: PasswordSignInResult) => void;
  onCancel?: () => void;
  /**
   * Offered a failed sign-in first: resolves `true` when the caller shows the failure itself,
   * as the sign-in list does for a revoked device.
   */
  onFailure?: (err: unknown) => Promise<boolean>;
}

/**
 * The password prompt of one account on this device: the password and "Keep me signed in".
 * It says when the password is wrong, when the next try must wait, and when 10 wrong tries
 * locked it, which offers the recovery phrase to set a new password. When this device's data
 * needs the recovery phrase it asks for the phrase, or to start empty.
 */
export function PasswordSignInForm({
  principalId,
  accountLabel,
  submitLabel = "Sign in",
  onSignedIn,
  onCancel,
  onFailure,
}: PasswordSignInFormProps) {
  const [password, setPassword] = useState("");
  const [keep, setKeep] = useState(() => keepSignedInByDefault(isTauri()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [resetting, setResetting] = useState(false);
  const recovery = useRecoveryQuestion();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setLocked(false);
    try {
      const result = await signInWithPassword(
        principalId,
        { password, keep },
        { onNeedsRecovery: recovery.onNeedsRecovery },
      );
      onSignedIn(result);
    } catch (err) {
      setPassword("");
      if (err instanceof PasswordLockedError) setLocked(true);
      if (onFailure && (await onFailure(err))) return;
      setError(signInFailure(err));
    } finally {
      setBusy(false);
    }
  }

  if (resetting) {
    return (
      <ResetPasswordWithPhrase
        principalId={principalId}
        accountLabel={accountLabel}
        onSignedIn={onSignedIn}
        onCancel={() => setResetting(false)}
      />
    );
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="space-y-3 rounded-lg border border-rim-line bg-rim-void/40 p-4"
    >
      <p className="text-sm font-medium text-rim-text">Password for {accountLabel}</p>
      {recovery.prompt ?? (
        <>
          <PasswordInput
            label="Password"
            value={password}
            onChange={setPassword}
            disabled={busy}
            autoFocus
          />
          <KeepSignedInCheckbox checked={keep} onChange={setKeep} disabled={busy} />
          {error && (
            <div
              role="alert"
              className="space-y-2 rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger"
            >
              <p>{error}</p>
              {locked && (
                <Button size="sm" variant="secondary" onClick={() => setResetting(true)}>
                  Use your recovery phrase
                </Button>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" isLoading={busy} disabled={!password}>
              {submitLabel}
            </Button>
            {onCancel && (
              <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
                Cancel
              </Button>
            )}
            {!locked && (
              <button
                type="button"
                onClick={() => setResetting(true)}
                disabled={busy}
                className="ml-auto text-xs text-rim-text-muted transition hover:text-rim-text"
              >
                Forgot it? Use your recovery phrase
              </button>
            )}
          </div>
        </>
      )}
    </form>
  );
}

/**
 * Sets a new password with the recovery phrase, then signs in with it. The account's other
 * devices ask once for the recovery phrase, or start empty.
 */
export function ResetPasswordWithPhrase({
  principalId,
  accountLabel,
  onSignedIn,
  onCancel,
}: {
  principalId: string;
  accountLabel: string;
  onSignedIn: (result: PasswordSignInResult) => void;
  onCancel: () => void;
}) {
  const [phrase, setPhrase] = useState("");
  const [next, setNext] = useState(EMPTY_NEW_PASSWORD);
  const [keep, setKeep] = useState(() => keepSignedInByDefault(isTauri()));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Set once the reset went through: a retry only signs in.
  const [done, setDone] = useState(false);
  const recovery = useRecoveryQuestion();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const nextProblem = newPasswordProblem(next);
    setProblem(nextProblem);
    if (nextProblem) return;
    const read = await readPhrase(phrase);
    if ("error" in read) {
      setError(read.error);
      return;
    }
    setBusy(true);
    try {
      if (!done) {
        try {
          await resetPassword(principalId, read.entropy, next.password);
        } catch (err) {
          setError(
            graphqlErrorCode(err) === UNAUTHENTICATED
              ? "This recovery phrase does not belong to this account, or the request expired. Check the phrase and try again."
              : graphqlErrorMessage(err, "The password could not be reset."),
          );
          return;
        }
        setDone(true);
      }
      onSignedIn(
        await signInWithPassword(
          principalId,
          { password: next.password, keep },
          { recoveryEntropy: read.entropy, onNeedsRecovery: recovery.onNeedsRecovery },
        ),
      );
    } catch (err) {
      const message = signInFailure(err);
      if (message) setError(`The new password is set, but signing in failed: ${message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="space-y-3 rounded-lg border border-rim-line bg-rim-void/40 p-4"
    >
      <p className="text-sm font-medium text-rim-text">New password for {accountLabel}</p>
      {recovery.prompt ?? (
        <>
          <p className="text-xs text-rim-text-muted">
            Your recovery phrase sets a new password. Every session of the account is signed out,
            and your other devices ask once for the recovery phrase.
          </p>
          <label className={labelClass}>
            Recovery phrase
            <textarea
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              rows={3}
              spellCheck={false}
              placeholder="12 words"
              className={textareaClass}
              disabled={busy || done}
            />
          </label>
          <NewPasswordFields
            label="New password"
            value={next}
            onChange={(value) => {
              setNext(value);
              setProblem(null);
            }}
            problem={problem}
            disabled={busy || done}
          />
          <KeepSignedInCheckbox checked={keep} onChange={setKeep} disabled={busy} />
          {error && (
            <p
              role="alert"
              className="rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger"
            >
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" isLoading={busy} disabled={!phrase.trim() || !next.password}>
              {done ? "Sign in" : "Set the new password"}
            </Button>
            <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
              Back
            </Button>
          </div>
        </>
      )}
    </form>
  );
}
