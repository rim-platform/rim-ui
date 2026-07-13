/**
 * `JoinForm` — registration form used on `/join/:token` and `/join` (open mode).
 *
 * Handles four token-type variants via the `variant` prop:
 * - `"WORKSPACE"`: header shows workspace name, copy says "Create your account."
 * - `"INSTANCE"`: header says "Create your RIM account." No workspace name. Routes via `instanceInviteToken`.
 * - `"BOOTSTRAP"`: same UI as INSTANCE ("Create your RIM account"). Routes via `bootstrapToken`.
 * - `"OPEN"`: same as INSTANCE copy but the form submits without any token.
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
 * // TODO: sync with iron-man when `passwordPolicy` is added to server config.
 *
 * Props:
 * - `variant` — token type discriminator; controls header copy and mutation input.
 * - `token` — raw token string (`null` for open registration).
 * - `workspaceName` — workspace name shown in the header when `variant === "WORKSPACE"`.
 * - `onSuccess(userId, serverId?)` — called after successful signup.
 */

import { useState } from "react";

import { useSignupWithInviteMutation } from "../api/useSignupWithInviteMutation";
import { InviteTokenType } from "../types";

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
   * - `BOOTSTRAP` — bootstrap token; same UI as INSTANCE but routes via `bootstrapToken`.
   * - `OPEN` — no token; open registration.
   */
  variant: JoinFormVariant;
  /** Raw invite token. `null` for open registration. */
  token: string | null;
  /** Workspace name shown in the header when `variant === "WORKSPACE"`. */
  workspaceName?: string;
  /**
   * Called on successful signup.
   * @param userId - The new user's ID.
   * @param serverId - Present only for workspace invite tokens.
   */
  onSuccess: (userId: string, serverId: string | null) => void;
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type?: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  hint,
  error,
  required,
}: FieldProps) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-rim-text-faint">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        placeholder={placeholder}
        required={required}
        className="w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2.5 text-sm text-rim-text outline-none transition placeholder:text-rim-text-faint focus:border-rim-accent/40"
      />
      {error && <span className="mt-1 block text-xs text-rim-danger">{error}</span>}
      {!error && hint && <span className="mt-1 block text-xs text-rim-text-faint">{hint}</span>}
    </label>
  );
}

/**
 * Returns the header copy for the given variant.
 *
 * BOOTSTRAP and INSTANCE share the same copy ("Create your RIM account") —
 * the distinction is only at the mutation-input level (`bootstrapToken` vs
 * `instanceInviteToken`).
 */
function headerCopy(variant: JoinFormVariant, workspaceName?: string): string {
  if (variant === InviteTokenType.WORKSPACE && workspaceName) {
    return `You're joining ${workspaceName}`;
  }
  // BOOTSTRAP, INSTANCE, and OPEN all show the same default copy.
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
export function JoinForm({ variant, token, workspaceName, onSuccess }: JoinFormProps) {
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
   * Validates the displayName field client-side (Hawkeye SF2).
   * Only validates when non-empty after trim — the field is optional.
   * Returns `false` and sets an inline error when the trimmed value exceeds
   * 80 characters (matching the backend's 1–80 char constraint).
   */
  function validateDisplayName(value: string): boolean {
    const trimmed = value.trim();
    if (trimmed.length > 80) {
      setDisplayNameError("Display name must be at most 80 characters.");
      return false;
    }
    setDisplayNameError(null);
    return true;
  }

  /**
   * Builds the `SignupWithInviteInput` for the mutation.
   *
   * - `email`: always included, trimmed client-side.
   * - `displayName`: omitted entirely from the payload when blank after trim
   *   (NOT sent as `""`). Falls back to `username` server-side.
   * - Token fields: exactly one is set per variant; none are set in OPEN mode.
   *   - `WORKSPACE` → `workspaceInviteToken`
   *   - `INSTANCE`  → `instanceInviteToken`
   *   - `BOOTSTRAP` → `bootstrapToken`
   */
  function buildInput() {
    const trimmedDisplayName = displayName.trim();
    const base = {
      username,
      email: email.trim(),
      password,
      ...(trimmedDisplayName.length > 0 ? { displayName: trimmedDisplayName } : {}),
    };

    if (variant === InviteTokenType.WORKSPACE && token) {
      return { ...base, workspaceInviteToken: token };
    }
    if (variant === InviteTokenType.INSTANCE && token) {
      return { ...base, instanceInviteToken: token };
    }
    if (variant === InviteTokenType.BOOTSTRAP && token) {
      return { ...base, bootstrapToken: token };
    }
    // OPEN — no token fields
    return base;
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
          setFormError(err instanceof Error ? err.message : "Registration failed. Try again.");
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
            <p className="mt-1 text-sm text-rim-text-faint">Create your account.</p>
          )}
        </header>

        <div className="rounded-xl border border-rim-line bg-rim-panel p-6">
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <Field
              label="Username"
              value={username}
              onChange={setUsername}
              placeholder="yourname"
              required
            />
            <Field
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
            <Field
              label="Password"
              value={password}
              onChange={setPassword}
              placeholder="password"
              type="password"
              hint="8 character minimum"
            />
            <Field
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
                {formError ??
                  (signup.error instanceof Error ? signup.error.message : "Registration failed.")}
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
        </div>
      </div>
    </div>
  );
}
