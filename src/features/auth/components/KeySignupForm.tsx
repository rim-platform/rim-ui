import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { getGraphqlEndpoint } from "../../../core/graphql/config";
import {
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
  discardKeySignup,
  KeyChallengeFailed,
  proofOfWorkRefused,
  signupWithKey,
  type EnrollmentDraft,
  type KeySignupFields,
  type KeySignupResult,
} from "../../key-identity/api/keyIdentity";
import { SaveRecoveryKit } from "../../key-identity/components/SaveRecoveryKit";
import { PowCancelled } from "../../relay/pow/proofOfWork";
import { useSignupTerms } from "../api/useSignupTerms";
import { checkDisplayName } from "../displayName";
import { JoinField } from "./JoinField";
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
    case VALIDATION:
      return general(graphqlErrorMessage(err, "The server did not accept these details."));
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
 * Creates an account from a key kept on this computer, with no password and no email: the
 * person picks a username, saves the recovery kit of the new keys, and the account is created
 * with them. On a relay that asks for a proof-of-work instead of an invite, this device finds
 * it first, which the person can cancel. A server with terms of service has the person accept
 * them before the keys are made. After a refusal they can try again with the same keys,
 * so the saved kit stays valid, or discard the keys. Only where this app can hold an identity
 * key.
 */
export function KeySignupForm({
  tokens,
  workspaceId,
  onSuccess,
  onBusyChange,
}: KeySignupFormProps) {
  const qc = useQueryClient();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [draft, setDraft] = useState<EnrollmentDraft | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [displayNameError, setDisplayNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const [proving, setProving] = useState<Proving | null>(null);
  const terms = useSignupTerms();
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
    onBusyChange?.(value);
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

  async function createKeys() {
    try {
      const next = await beginEnrollment(deviceName);
      pending.current = next;
      setDraft(next);
    } catch (err) {
      setFormError(graphqlErrorMessage(err, "Could not create the keys."));
    }
  }

  async function createAccount(current: EnrollmentDraft) {
    const trimmedDisplayName = displayName.trim();
    const stop = new AbortController();
    stopProof.current = stop;
    try {
      finish(
        await signupWithKey(
          current,
          {
            username: username.trim(),
            ...(trimmedDisplayName ? { displayName: trimmedDisplayName } : {}),
            ...tokens,
            ...terms.fields,
          },
          {
            onProofOfWork: (bits) => setProving({ bits, startedAt: Date.now() }),
            signal: stop.signal,
          },
        ),
      );
    } catch (err) {
      // Cancelled by the person: nothing to tell them, and Create account starts again.
      if (err instanceof PowCancelled) return;
      if (terms.noteFailure(err)) return;
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
    const nameError = checkDisplayName(displayName);
    if (nameError) {
      setDisplayNameError(nameError);
      return;
    }
    working(true);
    try {
      if (draft) await createAccount(draft);
      else await createKeys();
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
      const created = await discardKeySignup(current);
      if (created) {
        finish(created);
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
    terms.satisfied &&
    (draft
      ? saved && username.trim().length > 0
      : username.trim().length > 0 && deviceName.trim().length > 0);

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="space-y-4">
      <p className="text-sm text-rim-text-muted">
        No password and no email: this computer keeps a key that signs you in, and a recovery kit
        gets the account back if you lose it.
      </p>
      <JoinField
        label="Username"
        value={username}
        onChange={(v) => {
          setUsername(v);
          if (usernameError) setUsernameError(null);
        }}
        placeholder="yourname"
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
      {!draft && (
        <JoinField
          label="Name of this device"
          value={deviceName}
          onChange={setDeviceName}
          placeholder="Laptop"
          maxLength={64}
          required
        />
      )}
      {draft && <SaveRecoveryKit draft={draft} saved={saved} onSavedChange={setSaved} />}
      <TermsAcceptance terms={terms} disabled={busy} />
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
      {draft ? (
        <div className="flex gap-2">
          <Button type="submit" className="flex-1" isLoading={busy} disabled={!canSubmit}>
            Create account
          </Button>
          <Button type="button" variant="secondary" onClick={() => void discard()} disabled={busy}>
            Discard keys
          </Button>
        </div>
      ) : (
        <Button type="submit" className="w-full" isLoading={busy} disabled={!canSubmit}>
          Create keys
        </Button>
      )}
    </form>
  );
}
