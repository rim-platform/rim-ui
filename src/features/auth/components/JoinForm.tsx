/**
 * `JoinForm` — registration form used on `/join/:token` and `/join` (open mode).
 *
 * Handles three token-type variants via the `variant` prop:
 * - `"WORKSPACE"`: header shows workspace name, copy says "Create your account."
 * - `"INSTANCE"`: header says "Create your RIM account." No workspace name. Routes via `instanceInviteToken`.
 * - `"OPEN"`: same as INSTANCE copy but the form submits without any token.
 *
 * On the desktop the page also offers "Create account with a key" (`KeySignupForm`): an
 * account with no password and no email, signed in by a key kept on this computer. With
 * `keyOnly` (a relay in pow mode, no token) it offers only that.
 *
 * **Fields:**
 * - `username` — required, unique handle.
 * - `email` — required, validated client-side against `EMAIL_REGEX` before
 *   submit. Trimmed before send (server also trims + lowercases). If the server
 *   returns `EMAIL_TAKEN`, an inline error renders next to this field.
 * - `password` — required, 8 char minimum hint.
 * - `displayName` — optional. Trimmed before send; omitted entirely (not sent
 *   as `""`) when blank after trim. Falls back to `username` server-side.
 *
 * **Password policy note:**
 * The form shows a hardcoded "8 character minimum" hint. The backend enforces
 * its own rules and surfaces field errors on rejection.
 * // TODO: sync with the server when `passwordPolicy` is added to server config.
 *
 * Props:
 * - `variant` — token type discriminator; controls header copy and mutation input.
 * - `token` — raw token string (`null` for open registration).
 * - `workspaceName` — workspace name shown in the header when `variant === "WORKSPACE"`.
 * - `workspaceId` — the invite's workspace, from its preview, when `variant === "WORKSPACE"`.
 * - `invitedBy`, `ownerName` — who invited and who owns the workspace, from its preview.
 * - `onSuccess(userId, serverId?)` — called after successful signup.
 */

import { useState } from "react";

import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { useSignupWithInviteMutation } from "../api/useSignupWithInviteMutation";
import { checkDisplayName } from "../displayName";
import { InviteTokenType } from "../types";
import { InviteByline } from "./InviteByline";
import { JoinField } from "./JoinField";
import { KeySignupForm, type KeySignupTokens } from "./KeySignupForm";

/**
 * Email validation regex mirroring the backend's pragmatic email regex.
 * Spec §13b: `^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$`
 * Exported so tests can import the same constant rather than duplicating it.
 */
export const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

type JoinFormVariant = InviteTokenType | "OPEN";

interface JoinFormProps {
  /**
   * Which registration path this form represents.
   * - `WORKSPACE` — workspace invite token, shows workspace name.
   * - `INSTANCE` — instance invite token; routes via `instanceInviteToken`.
   * - `OPEN` — no token; open registration.
   */
  variant: JoinFormVariant;
  /** Raw invite token. `null` for open registration. */
  token: string | null;
  /** Workspace name shown in the header when `variant === "WORKSPACE"`. */
  workspaceName?: string;
  /** The invite's workspace, from its preview, when `variant === "WORKSPACE"`. */
  workspaceId?: string;
  /** Who sent the workspace invite, from its preview. */
  invitedBy?: string;
  /** The invite's workspace owner, from its preview; null when it has none. */
  ownerName?: string | null;
  /** Offer only the key signup: the server takes no password signup without a token. */
  keyOnly?: boolean;
  /**
   * Called on successful signup.
   * @param userId - The new user's ID.
   * @param serverId - Present only for workspace invite tokens.
   */
  onSuccess: (userId: string, serverId: string | null) => void;
}

/**
 * The token field a signup sends for the given variant: exactly one for a token variant, none
 * in OPEN mode.
 *   - `WORKSPACE` → `workspaceInviteToken`
 *   - `INSTANCE`  → `instanceInviteToken`
 */
function tokenFields(variant: JoinFormVariant, token: string | null): KeySignupTokens {
  if (!token) return {};
  if (variant === InviteTokenType.WORKSPACE) return { workspaceInviteToken: token };
  if (variant === InviteTokenType.INSTANCE) return { instanceInviteToken: token };
  return {};
}

/** Returns the header copy for the given variant. */
function headerCopy(variant: JoinFormVariant, workspaceName?: string): string {
  if (variant === InviteTokenType.WORKSPACE && workspaceName) {
    return `You're joining ${workspaceName}`;
  }
  // INSTANCE and OPEN show the same default copy.
  return "Create your RIM account";
}

/**
 * Maps a GraphQL error extension code from `signupWithInvite` to a
 * `{ field: "email" | "general", message: string }` descriptor.
 *
 * Returns `null` when the error is not a recognised typed code (falls back
 * to the generic error banner).
 */
function mapSignupError(err: unknown): { field: "email" | "general"; message: string } | null {
  if (err && typeof err === "object") {
    const e = err as { response?: { errors?: Array<{ extensions?: { code?: string } }> } };
    const code = e.response?.errors?.[0]?.extensions?.code;
    if (code === "EMAIL_TAKEN") {
      return { field: "email", message: "This email is already in use. Try logging in instead." };
    }
  }
  return null;
}

/**
 * Signup form for all registration paths (invite token + open registration).
 */
export function JoinForm({
  variant,
  token,
  workspaceName,
  workspaceId,
  invitedBy,
  ownerName,
  keyOnly = false,
  onSuccess,
}: JoinFormProps) {
  const { capabilities } = useRuntime();
  // Where this device can keep a key, the key signup comes first; the password form is the
  // fallback behind the toggle.
  const [chosen, setMethod] = useState<"password" | "key">(() =>
    capabilities.identityKeys ? "key" : "password",
  );
  const method = keyOnly ? "key" : chosen;
  // A key signup in progress keeps its form mounted until it settles.
  const [keySignupBusy, setKeySignupBusy] = useState(false);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [displayNameError, setDisplayNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const signup = useSignupWithInviteMutation();

  /**
   * Validates the email field client-side. Sets inline error and returns
   * `false` if invalid, clears error and returns `true` if valid.
   */
  function validateEmail(value: string): boolean {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      setEmailError("Email is required.");
      return false;
    }
    if (trimmed.length > 254) {
      setEmailError("Email must be 254 characters or fewer.");
      return false;
    }
    if (!EMAIL_REGEX.test(trimmed)) {
      setEmailError("Please enter a valid email address.");
      return false;
    }
    setEmailError(null);
    return true;
  }

  /**
   * Validates the displayName field client-side.
   * Only validates when non-empty after trim — the field is optional.
   * Returns `false` and sets an inline error when the trimmed value exceeds
   * 80 characters (matching the backend's 1–80 char constraint).
   */
  function validateDisplayName(value: string): boolean {
    const error = checkDisplayName(value);
    setDisplayNameError(error);
    return error === null;
  }

  /**
   * Builds the `SignupWithInviteInput` for the mutation.
   *
   * - `email`: always included, trimmed client-side.
   * - `displayName`: omitted entirely from the payload when blank after trim
   *   (NOT sent as `""`). Falls back to `username` server-side.
   * - Token fields: from `tokenFields`.
   */
  function buildInput() {
    const trimmedDisplayName = displayName.trim();
    return {
      username,
      email: email.trim(),
      password,
      ...(trimmedDisplayName.length > 0 ? { displayName: trimmedDisplayName } : {}),
      ...tokenFields(variant, token),
    };
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    // Client-side validation gates — prevents round-trips for obvious invalid
    // input. Server remains the source of truth for uniqueness and final rules.
    if (!validateEmail(email)) {
      return;
    }
    if (!validateDisplayName(displayName)) {
      return;
    }

    signup.mutate(buildInput(), {
      onSuccess: (data) => {
        onSuccess(data.signupWithInvite.userId, data.signupWithInvite.serverId ?? null);
      },
      onError: (err) => {
        const mapped = mapSignupError(err);
        if (mapped?.field === "email") {
          setEmailError(mapped.message);
        } else {
          setFormError(graphqlErrorMessage(err, "Registration failed. Try again."));
        }
      },
    });
  }

  const canSubmit =
    username.trim().length > 0 && email.trim().length > 0 && password.trim().length >= 8;

  return (
    <div className="flex min-h-screen items-center justify-center bg-rim-void p-4">
      <div className="w-full max-w-lg space-y-6">
        <header className="text-center">
          <h1 className="text-2xl font-semibold text-rim-text">RIM</h1>
          <p className="mt-1 text-sm text-rim-text-muted">{headerCopy(variant, workspaceName)}</p>
          {variant === InviteTokenType.WORKSPACE && workspaceName && (
            <>
              <InviteByline invitedBy={invitedBy} ownerName={ownerName} />
              <p className="mt-1 text-sm text-rim-text-faint">Create your account.</p>
            </>
          )}
        </header>

        <div className="rounded-xl border border-rim-line bg-rim-panel p-6">
          {method === "key" ? (
            <KeySignupForm
              tokens={tokenFields(variant, token)}
              workspaceId={variant === InviteTokenType.WORKSPACE ? workspaceId : undefined}
              onSuccess={onSuccess}
              onBusyChange={setKeySignupBusy}
            />
          ) : (
            <form onSubmit={handleSubmit} noValidate className="space-y-4">
              <JoinField
                label="Username"
                value={username}
                onChange={setUsername}
                placeholder="yourname"
                required
              />
              <JoinField
                label="Email"
                value={email}
                onChange={(v) => {
                  setEmail(v);
                  // Clear inline error on edit so the user isn't blocked while typing.
                  if (emailError) setEmailError(null);
                }}
                placeholder="you@example.com"
                type="email"
                error={emailError}
                required
              />
              <JoinField
                label="Password"
                value={password}
                onChange={setPassword}
                placeholder="password"
                type="password"
                hint="8 character minimum"
              />
              <JoinField
                label="Display name (optional)"
                value={displayName}
                onChange={(v) => {
                  setDisplayName(v);
                  // Clear the inline error while the user edits.
                  if (displayNameError) setDisplayNameError(null);
                }}
                placeholder=""
                hint="If left blank, your username will be shown."
                error={displayNameError}
              />
              {(formError || signup.error) && !emailError && (
                <p className="rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger">
                  {formError ?? graphqlErrorMessage(signup.error, "Registration failed.")}
                </p>
              )}
              <button
                type="submit"
                disabled={signup.isPending || !canSubmit}
                className="w-full rounded-lg bg-rim-accent px-4 py-2.5 text-sm font-medium text-rim-void transition hover:bg-rim-accent-strong disabled:opacity-50"
              >
                {signup.isPending ? "Creating account..." : "Create account"}
              </button>
            </form>
          )}
        </div>

        {capabilities.identityKeys && !keyOnly && (
          <div className="space-y-3 text-center">
            <div className="flex items-center gap-3 text-xs text-rim-text-faint">
              <span className="flex-1 border-t border-rim-line" />
              <span>OR</span>
              <span className="flex-1 border-t border-rim-line" />
            </div>
            <button
              type="button"
              onClick={() => setMethod(method === "key" ? "password" : "key")}
              disabled={keySignupBusy}
              className="inline-block rounded-lg border border-rim-line bg-rim-void px-4 py-2 text-sm text-rim-text-muted transition hover:text-rim-text disabled:opacity-50"
            >
              {method === "key" ? "Create account with a password" : "Create account with a key"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
