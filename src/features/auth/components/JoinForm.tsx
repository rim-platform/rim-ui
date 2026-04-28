/**
 * `JoinForm` — registration form used on `/join/:token` and `/join` (open mode).
 *
 * Handles three token-type variants via the `variant` prop:
 * - `"WORKSPACE"`: header shows workspace name, copy says "Create your account."
 * - `"INSTANCE"`: header says "Create your RIM account." No workspace name.
 * - `"OPEN"`: same as INSTANCE copy but the form submits without any token.
 *
 * **Schema drift note (spec r2 vs actual SDL):**
 * The spec §4.2 assumed `email` + `displayName` fields on the signup input.
 * The actual `SignupWithInviteInput` SDL uses `username` (not email) and has
 * no `displayName` field — the backend derives that server-side. The form
 * renders `username` accordingly. This is a confirmed drift to report back to
 * Vision.
 *
 * **Password policy note:**
 * The form shows a hardcoded "8 character minimum" hint. The backend enforces
 * its own rules and surfaces field errors on rejection.
 * // TODO: sync with iron-man when `passwordPolicy` is added to server config.
 *
 * Props:
 * - `variant` — token type discriminator; controls header copy and mutation input.
 * - `token` — raw token string (`null` for open registration).
 * - `onSuccess(userId, serverId?)` — called after successful signup.
 */

import { useState } from "react";

import { useSignupWithInviteMutation } from "../api/useSignupWithInviteMutation";
import { InviteTokenType } from "../types";

type JoinFormVariant = InviteTokenType | "OPEN";

interface JoinFormProps {
  /**
   * Which registration path this form represents.
   * - `WORKSPACE` — workspace invite token, shows workspace name.
   * - `INSTANCE` — instance/bootstrap invite token.
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
}

function Field({ label, value, onChange, placeholder, type = "text", hint }: FieldProps) {
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
        className="w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2.5 text-sm text-rim-text outline-none transition placeholder:text-rim-text-faint focus:border-rim-accent/40"
      />
      {hint && (
        <span className="mt-1 block text-xs text-rim-text-faint">{hint}</span>
      )}
    </label>
  );
}

function headerCopy(variant: JoinFormVariant, workspaceName?: string): string {
  if (variant === InviteTokenType.WORKSPACE && workspaceName) {
    return `You're joining ${workspaceName}`;
  }
  return "Create your RIM account";
}

/**
 * Signup form for all registration paths (invite token + open registration).
 */
export function JoinForm({ variant, token, workspaceName, onSuccess }: JoinFormProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const signup = useSignupWithInviteMutation();
  const [formError, setFormError] = useState<string | null>(null);

  function buildInput() {
    if (variant === InviteTokenType.WORKSPACE && token) {
      return { username, password, workspaceInviteToken: token };
    }
    if (variant === InviteTokenType.INSTANCE && token) {
      return { username, password, instanceInviteToken: token };
    }
    // OPEN — no token fields
    return { username, password };
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    signup.mutate(buildInput(), {
      onSuccess: (data) => {
        onSuccess(
          data.signupWithInvite.userId,
          data.signupWithInvite.serverId ?? null,
        );
      },
      onError: (err) => {
        setFormError(
          err instanceof Error ? err.message : "Registration failed. Try again.",
        );
      },
    });
  }

  const canSubmit = username.trim().length > 0 && password.trim().length >= 8;

  return (
    <div className="flex min-h-screen items-center justify-center bg-rim-void p-4">
      <div className="w-full max-w-lg space-y-6">
        <header className="text-center">
          <h1 className="text-2xl font-semibold text-rim-text">RIM</h1>
          <p className="mt-1 text-sm text-rim-text-muted">
            {headerCopy(variant, workspaceName)}
          </p>
          {variant === InviteTokenType.WORKSPACE && workspaceName && (
            <p className="mt-1 text-sm text-rim-text-faint">Create your account.</p>
          )}
        </header>

        <div className="rounded-xl border border-rim-line bg-rim-panel p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <Field
              label="Username"
              value={username}
              onChange={setUsername}
              placeholder="yourname"
            />
            <Field
              label="Password"
              value={password}
              onChange={setPassword}
              placeholder="password"
              type="password"
              hint="8 character minimum"
            />
            {(formError || signup.error) && (
              <p className="rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger">
                {formError ??
                  (signup.error instanceof Error
                    ? signup.error.message
                    : "Registration failed.")}
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
