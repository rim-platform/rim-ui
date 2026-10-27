import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isTauri } from "@tauri-apps/api/core";

import { getGraphqlEndpoint } from "../../../core/graphql/config";
import {
  asSentence,
  CONFLICT,
  EXPIRED_TOKEN,
  graphqlErrorCode,
  graphqlErrorMessage,
  INVALID_TOKEN,
  RATE_LIMITED,
  retryAfterSeconds,
  UNAUTHENTICATED,
  VALIDATION,
} from "../../../core/graphql/errors";
import { queryKeys } from "../../../core/query/keys";
import { Button } from "../../../shared/ui/Button";
import {
  abandonKeySignup,
  beginEnrollment,
  defaultDeviceName,
  deviceKeepsRecoveryKit,
  discardKeySignup,
  KeyChallengeFailed,
  proofOfWorkRefused,
  RegistrationClosed,
  RegistrationUnreadable,
  signupWithKey,
  type EnrollmentDraft,
  type KeySignupFields,
  type KeySignupResult,
} from "../../key-identity/api/keyIdentity";
import { RecoveryKitScreen } from "../../key-identity/components/RecoveryKitScreen";
import { SaveRecoveryKit } from "../../key-identity/components/SaveRecoveryKit";
import { useKeyStorageConsent } from "../../key-identity/components/useKeyStorageConsent";
import { PowCancelled } from "../../relay/pow/proofOfWork";
import { useSignupTerms } from "../api/useSignupTerms";
import { useSignupMinimumAge } from "../api/useMinimumAge";
import { isRegistrationFull, REGISTRATION_FULL_MESSAGE } from "../api/registrationFull";
import { checkDisplayName } from "../displayName";
import { EMPTY_NEW_PASSWORD, keepSignedInByDefault, newPasswordProblem } from "../password";
import { usernameHint, usernameProblem } from "../username";
import { JoinField } from "./JoinField";
import { KeepSignedInCheckbox, NewPasswordFields } from "./PasswordFields";
import { MinimumAgeConfirmation } from "./MinimumAgeConfirmation";
import { TermsAcceptance } from "./TermsAcceptance";

/** The token fields of `signupWithKey`: one for an invite link, none in open mode. */
export type KeySignupTokens = Pick<KeySignupFields, "instanceInviteToken" | "workspaceInviteToken">;

interface KeySignupFormProps {
  tokens: KeySignupTokens;
  /** The invite's workspace, from its preview, for a workspace invite. */
  workspaceId?: string;
  onSuccess: (userId: string, serverId: string | null) => void;
  /** Told when a step that must not be interrupted starts and ends. */
  onBusyChange?: (busy: boolean) => void;
  /** Whether the page's own fields let the signup go ahead; `true` when absent. */
  ready?: boolean;
  /**
   * Offered a failed signup first: returns `true` when the page shows the failure itself, as an
   * invite code field does with a refused token.
   */
  onFailure?: (err: unknown) => boolean;
  /**
   * Told as soon as the server has created the account, before the person is done with the
   * recovery kit.
   */
  onAccountCreated?: (userId: string) => void;
}

/** `retry` offers to try again: a refused proof-of-work is searched for again. */
type SignupError = { field: "username" | "general"; message: string; retry?: boolean };

function general(message: string): SignupError {
  return { field: "general", message };
}

/** After this long the proof-of-work note says how long it can take. */
const SLOW_PROOF_SECONDS = 10;

/** About how many hashes a proof-of-work of `bits` bits takes, in words. */
function triesInWords(bits: number): string {
  const tries = 2 ** bits;
  if (tries >= 1e9) return `${(tries / 1e9).toFixed(1)} billion`;
  if (tries >= 1e6) return `${(tries / 1e6).toFixed(1)} million`;
  if (tries >= 1e3) return `${Math.round(tries / 1e3)} thousand`;
  return String(tries);
}

/** What a failed key signup tells the person, and the field it belongs to. */
function signupError(err: unknown): SignupError {
  if (proofOfWorkRefused(err)) {
    return {
      field: "general",
      message: graphqlErrorMessage(err, "The server did not accept the proof-of-work."),
      retry: true,
    };
  }
  if (err instanceof RegistrationUnreadable) {
    return { field: "general", message: err.message, retry: true };
  }
  if (err instanceof RegistrationClosed || isRegistrationFull(err)) {
    return general(REGISTRATION_FULL_MESSAGE);
  }
  if (err instanceof KeyChallengeFailed) {
    return graphqlErrorCode(err.reason) === RATE_LIMITED
      ? general("Too many attempts from this network. Wait a minute and try again.")
      : general(err.message);
  }
  switch (graphqlErrorCode(err)) {
    case CONFLICT:
      // Told apart by the server's message; a code of its own for a key identity in use would
      // be sturdier.
      return /key identity/i.test(graphqlErrorMessage(err, ""))
        ? general(
            "An account on this server already uses these keys. Sign in with this device from the sign-in page.",
          )
        : { field: "username", message: "This username is taken. Choose another." };
    case VALIDATION: {
      const message = graphqlErrorMessage(err, "");
      if (/\busernames?\b/i.test(message)) {
        return { field: "username", message: asSentence(message) };
      }
      if (/this name is reserved/i.test(message)) {
        return general(
          "This name is reserved on this server. Choose another username or display name.",
        );
      }
      return general(asSentence(message) || "The server did not accept these details.");
    }
    case RATE_LIMITED: {
      const seconds = retryAfterSeconds(err);
      if (seconds === undefined) {
        return general("Too many sign-ups from this network. Try again later.");
      }
      const minutes = Math.max(1, Math.ceil(seconds / 60));
      return general(
        `Too many sign-ups from this network. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      );
    }
    case INVALID_TOKEN:
      return general("This invite link is no longer valid. Ask for a new one.");
    case EXPIRED_TOKEN:
      return general("This invite link has expired. Ask for a new one.");
    case UNAUTHENTICATED:
      return general("The server did not accept this computer's signature. Try again.");
    default:
      return general(graphqlErrorMessage(err, "Could not create the account. Try again."));
  }
}

/** The proof-of-work under way: its difficulty and when it started. */
interface Proving {
  bits: number;
  startedAt: number;
}

/** "Proving this is a real device…" with the time it has taken, and a way to stop it. */
function ProofOfWorkStatus({ proving, onCancel }: { proving: Proving; onCancel: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - proving.startedAt) / 1000));
  return (
    <div
      role="status"
      className="space-y-2 rounded-lg border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text-muted"
    >
      <div className="flex items-center justify-between gap-3">
        <span>Proving this is a real device… {seconds} s</span>
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {seconds >= SLOW_PROOF_SECONDS && (
        <p className="text-xs text-rim-text-faint">
          This relay asks every new account for about {triesInWords(proving.bits)} hashes, to keep
          out automated sign-ups. That takes seconds in the desktop app and can take tens of seconds
          in a browser.
        </p>
      )}
    </div>
  );
}

/**
 * Creates an account from a key kept on this device and a password, with no email: the person
 * picks a username and a password (a PIN or a passphrase, typed twice, and whether to stay
 * signed in), and the account is created with new keys. Where this device keeps the
 * recovery kit until it is confirmed, the account is created first and the kit shown after;
 * elsewhere the person saves the kit before the account is created. Before any key is made the
 * browser is asked to keep this site's data, and a refusal needs the person's go-ahead. On a
 * relay that asks for a proof-of-work instead of an invite, this device finds it first, which
 * the person can cancel; a relay whose discovery document says it is full is not asked. A server
 * with terms of service, or a minimum age, has the person accept them, or confirm it, before the
 * keys are made. After a refusal they can try again with the same keys,
 * so a saved kit stays valid, or start over with new keys where the kit was saved first. The
 * username is checked against the server's rules before anything is sent. Only where this app
 * can hold an identity key.
 */
export function KeySignupForm({
  tokens,
  workspaceId,
  onSuccess,
  onBusyChange,
  ready = true,
  onFailure,
  onAccountCreated,
}: KeySignupFormProps) {
  const qc = useQueryClient();
  // Read once: the form follows one flow from start to end.
  const [kitAfter] = useState(deviceKeepsRecoveryKit);
  const storage = useKeyStorageConsent();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [password, setPassword] = useState(EMPTY_NEW_PASSWORD);
  const [passwordProblem, setPasswordProblem] = useState<string | null>(null);
  const [keep, setKeep] = useState(() => keepSignedInByDefault(isTauri()));
  const [draft, setDraft] = useState<EnrollmentDraft | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [displayNameError, setDisplayNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const [proving, setProving] = useState<Proving | null>(null);
  // The account created with the kit still to save, shown until the person closes the kit.
  const [created, setCreated] = useState<KeySignupResult | null>(null);
  const createdRef = useRef(false);
  const terms = useSignupTerms();
  const age = useSignupMinimumAge();
  // The draft to give up on if the page closes before the account is created.
  const pending = useRef<EnrollmentDraft | null>(null);
  // Stops the proof-of-work under way.
  const stopProof = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    void defaultDeviceName().then((name) => {
      if (!cancelled) setDeviceName((current) => current || name);
    });
    return () => {
      cancelled = true;
      stopProof.current?.abort();
      if (pending.current) void abandonKeySignup(pending.current).catch(() => undefined);
    };
  }, []);

  function working(value: boolean) {
    setBusy(value);
    // The page keeps this form while the new account's kit is on screen, too.
    onBusyChange?.(value || createdRef.current);
  }

  /** Open the new account the way the page opens a password signup's. */
  function finish({ userId, serverId }: KeySignupResult) {
    pending.current = null;
    // The kit is saved and the account has its keys: the phrase leaves memory here.
    setDraft(null);
    void qc.invalidateQueries({ queryKey: queryKeys.me });
    void qc.invalidateQueries({ queryKey: queryKeys.deviceKeyAccounts(getGraphqlEndpoint()) });
    // An account found only after its answer was lost has no server id; a workspace invite
    // still joined the workspace its preview named.
    onSuccess(userId, serverId ?? (tokens.workspaceInviteToken ? (workspaceId ?? null) : null));
  }

  /** The new keys, or `null` when they were not made (the person went back, or it failed). */
  async function createKeys(): Promise<EnrollmentDraft | null> {
    if (!(await storage.ensure())) return null;
    try {
      const next = await beginEnrollment(deviceName);
      pending.current = next;
      setDraft(next);
      return next;
    } catch (err) {
      setFormError(graphqlErrorMessage(err, "Could not create the keys."));
      return null;
    }
  }

  /** The account exists: open it now, or once the person is done with the kit. */
  function accountCreated(result: KeySignupResult) {
    onAccountCreated?.(result.userId);
    if (!kitAfter) {
      finish(result);
      return;
    }
    pending.current = null;
    createdRef.current = true;
    setCreated(result);
  }

  async function createAccount(current: EnrollmentDraft) {
    const trimmedDisplayName = displayName.trim();
    const stop = new AbortController();
    stopProof.current = stop;
    try {
      accountCreated(
        await signupWithKey(
          current,
          {
            username: username.trim(),
            ...(trimmedDisplayName ? { displayName: trimmedDisplayName } : {}),
            ...tokens,
            ...terms.fields,
            ...age.fields,
          },
          { password: password.password, keep },
          {
            onProofOfWork: (bits) => setProving({ bits, startedAt: Date.now() }),
            signal: stop.signal,
            recoveryKit: kitAfter ? "later" : "saved",
          },
        ),
      );
    } catch (err) {
      // Cancelled by the person: nothing to tell them, and Create account starts again.
      if (err instanceof PowCancelled) return;
      if (terms.noteFailure(err)) return;
      if (age.noteFailure(err)) return;
      if (onFailure?.(err)) return;
      // The draft stays: trying again uses the same keys, so the saved kit stays valid.
      const mapped = signupError(err);
      if (mapped.field === "username") setUsernameError(mapped.message);
      else setFormError(mapped.message);
      setCanRetry(mapped.retry === true);
    } finally {
      stopProof.current = null;
      setProving(null);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setCanRetry(false);
    const nameProblem = usernameProblem(username);
    if (nameProblem) {
      setUsernameError(nameProblem);
      return;
    }
    const nameError = checkDisplayName(displayName);
    if (nameError) {
      setDisplayNameError(nameError);
      return;
    }
    // The password is checked when the account is about to be created.
    if (draft || kitAfter) {
      const problem = newPasswordProblem(password);
      setPasswordProblem(problem);
      if (problem) return;
    }
    working(true);
    try {
      if (draft) {
        await createAccount(draft);
      } else {
        const next = await createKeys();
        // Where the kit is shown after, the account is created with the new keys right away.
        if (next && kitAfter) await createAccount(next);
      }
    } finally {
      working(false);
    }
  }

  async function discard() {
    const current = pending.current;
    if (!current) return;
    setFormError(null);
    working(true);
    try {
      // An attempt that failed here may have created the account after all: then it is opened.
      const found = await discardKeySignup(current, { password: password.password, keep });
      if (found) {
        accountCreated(found);
        return;
      }
    } catch (err) {
      setFormError(graphqlErrorMessage(err, "Could not discard the keys."));
      return;
    } finally {
      working(false);
    }
    pending.current = null;
    setDraft(null);
    setSaved(false);
  }

  const canSubmit =
    ready &&
    terms.satisfied &&
    age.satisfied &&
    (draft
      ? (kitAfter || saved) && username.trim().length > 0 && password.password.length > 0
      : username.trim().length > 0 &&
        deviceName.trim().length > 0 &&
        (!kitAfter || password.password.length > 0));

  if (created && draft) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-rim-text-muted">Your account is ready.</p>
        <RecoveryKitScreen
          kit={draft}
          onClose={() => {
            createdRef.current = false;
            onBusyChange?.(false);
            finish(created);
          }}
        />
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="space-y-4">
      <p className="text-sm text-rim-text-muted">
        No email: this device keeps a key that signs you in together with your password, and a
        recovery kit gets the account back if you lose it.
      </p>
      <JoinField
        label="Username"
        value={username}
        onChange={(v) => {
          setUsername(v);
          if (usernameError) setUsernameError(null);
        }}
        placeholder="yourname"
        hint={usernameHint(username)}
        error={usernameError}
        required
      />
      <JoinField
        label="Display name (optional)"
        value={displayName}
        onChange={(v) => {
          setDisplayName(v);
          if (displayNameError) setDisplayNameError(null);
        }}
        placeholder=""
        hint="If left blank, your username will be shown."
        error={displayNameError}
      />
      {(!draft || kitAfter) && (
        <JoinField
          label="Name of this device"
          value={deviceName}
          onChange={setDeviceName}
          placeholder="Laptop"
          maxLength={64}
          required
          disabled={draft !== null}
        />
      )}
      {draft && !kitAfter && (
        <SaveRecoveryKit draft={draft} saved={saved} onSavedChange={setSaved} />
      )}
      <NewPasswordFields
        value={password}
        onChange={(value) => {
          setPassword(value);
          setPasswordProblem(null);
        }}
        problem={passwordProblem}
        disabled={busy}
      />
      <KeepSignedInCheckbox checked={keep} onChange={setKeep} disabled={busy} />
      <TermsAcceptance terms={terms} disabled={busy} />
      <MinimumAgeConfirmation age={age} disabled={busy} />
      {proving && (
        <ProofOfWorkStatus proving={proving} onCancel={() => stopProof.current?.abort()} />
      )}
      {formError && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger"
        >
          <span>{formError}</span>
          {canRetry && draft && (
            <Button type="submit" variant="secondary" size="sm" disabled={busy || !canSubmit}>
              Try again
            </Button>
          )}
        </div>
      )}
      {storage.prompt}
      {draft ? (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Button type="submit" className="flex-1" isLoading={busy} disabled={!canSubmit}>
              Create account
            </Button>
            {!kitAfter && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => void discard()}
                disabled={busy}
              >
                Start over
              </Button>
            )}
          </div>
          {!kitAfter && (
            <p className="text-xs text-rim-text-faint">
              Start over makes new keys and a new recovery kit; the kit you saved stops working.
            </p>
          )}
        </div>
      ) : (
        <Button type="submit" className="w-full" isLoading={busy} disabled={!canSubmit}>
          {kitAfter ? "Create account" : "Create keys"}
        </Button>
      )}
    </form>
  );
}
