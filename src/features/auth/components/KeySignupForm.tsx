import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { getGraphqlEndpoint } from "../../../core/graphql/config";
import {
  graphqlErrorCode,
  graphqlErrorMessage,
  RATE_LIMITED,
  retryAfterSeconds,
  UNAUTHENTICATED,
} from "../../../core/graphql/errors";
import { queryKeys } from "../../../core/query/keys";
import { Button } from "../../../shared/ui/Button";
import {
  abandonKeySignup,
  beginEnrollment,
  defaultDeviceName,
  signupWithKey,
  type EnrollmentDraft,
  type KeySignupFields,
} from "../../key-identity/api/keyIdentity";
import { SaveRecoveryKit } from "../../key-identity/components/SaveRecoveryKit";
import { JoinField } from "./JoinField";

/** The token fields of `signupWithKey`: one for an invite or bootstrap link, none in open mode. */
export type KeySignupTokens = Pick<
  KeySignupFields,
  "bootstrapToken" | "instanceInviteToken" | "workspaceInviteToken"
>;

interface KeySignupFormProps {
  tokens: KeySignupTokens;
  onSuccess: (userId: string, serverId: string | null) => void;
}

/** What a refused `signupWithKey` tells the person, and the field it belongs to. */
function signupError(err: unknown): { field: "username" | "general"; message: string } {
  switch (graphqlErrorCode(err)) {
    case "CONFLICT":
      if (/key identity/i.test(graphqlErrorMessage(err, ""))) {
        return {
          field: "general",
          message:
            "An account on this server already uses these keys. Sign in with this device from the sign-in page.",
        };
      }
      return { field: "username", message: "This username is taken. Choose another." };
    case "VALIDATION":
      return {
        field: "general",
        message: graphqlErrorMessage(err, "The server did not accept these details."),
      };
    case RATE_LIMITED: {
      const seconds = retryAfterSeconds(err);
      const minutes = seconds === undefined ? null : Math.max(1, Math.ceil(seconds / 60));
      return {
        field: "general",
        message:
          minutes === null
            ? "Too many sign-ups from this network. Try again later."
            : `Too many sign-ups from this network. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      };
    }
    case "INVALID_TOKEN":
      return {
        field: "general",
        message: "This invite link is no longer valid. Ask for a new one.",
      };
    case "EXPIRED_TOKEN":
      return { field: "general", message: "This invite link has expired. Ask for a new one." };
    case UNAUTHENTICATED:
      return {
        field: "general",
        message: "The server did not accept this computer's signature. Try again.",
      };
    default:
      return {
        field: "general",
        message: graphqlErrorMessage(err, "Could not create the account. Try again."),
      };
  }
}

/**
 * Creates an account from a key kept on this computer, with no password and no email: the
 * person picks a username, saves the recovery kit of the new keys, and the account is created
 * with them. After a refusal they can try again with the same keys, so the saved kit stays
 * valid, or discard the keys. Desktop only.
 */
export function KeySignupForm({ tokens, onSuccess }: KeySignupFormProps) {
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
  // The draft to give up on if the page closes before the account is created.
  const pending = useRef<EnrollmentDraft | null>(null);

  useEffect(() => {
    let cancelled = false;
    void defaultDeviceName().then((name) => {
      if (!cancelled) setDeviceName((current) => current || name);
    });
    return () => {
      cancelled = true;
      if (pending.current) void abandonKeySignup(pending.current).catch(() => undefined);
    };
  }, []);

  function validateDisplayName(): boolean {
    if (displayName.trim().length > 80) {
      setDisplayNameError("Display name must be at most 80 characters.");
      return false;
    }
    return true;
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
    try {
      const { userId, serverId } = await signupWithKey(current, {
        username: username.trim(),
        ...(trimmedDisplayName ? { displayName: trimmedDisplayName } : {}),
        ...tokens,
      });
      pending.current = null;
      // The kit is saved and the account has its keys: the phrase leaves memory here.
      setDraft(null);
      void qc.invalidateQueries({ queryKey: queryKeys.me });
      void qc.invalidateQueries({ queryKey: queryKeys.deviceKeyAccounts(getGraphqlEndpoint()) });
      onSuccess(userId, serverId);
    } catch (err) {
      // The draft stays: trying again uses the same keys, so the saved kit stays valid.
      const mapped = signupError(err);
      if (mapped.field === "username") setUsernameError(mapped.message);
      else setFormError(mapped.message);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!validateDisplayName()) return;
    setBusy(true);
    try {
      if (draft) await createAccount(draft);
      else await createKeys();
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    const current = pending.current;
    pending.current = null;
    setDraft(null);
    setSaved(false);
    setFormError(null);
    if (current) await abandonKeySignup(current).catch(() => undefined);
  }

  const canSubmit = draft
    ? saved && username.trim().length > 0
    : username.trim().length > 0 && deviceName.trim().length > 0;

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
      {formError && (
        <p
          role="alert"
          className="rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger"
        >
          {formError}
        </p>
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
