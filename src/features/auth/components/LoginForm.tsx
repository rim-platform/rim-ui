/**
 * `LoginForm` — the username + password form used on the `/login` route.
 *
 * Extracted from the old `AuthGate.tsx` `LoginForm` sub-component. No tab
 * parent; no Bootstrap form sibling. The component is "controlled" in the
 * sense that it owns its own field state and calls its mutation internally —
 * the parent (`LoginPage`) provides an `onSuccess` callback.
 *
 * Props:
 * - `onSuccess(userId)` — called after the login mutation resolves. The
 *   parent is responsible for navigation / session update.
 */

import { useState } from "react";
import { Link } from "react-router-dom";

import { useLoginMutation } from "../api/useAuthMutations";

interface LoginFormProps {
  /** Called with the authenticated user's ID on successful login. */
  onSuccess: (userId: string) => void;
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type?: string;
}

function Field({ label, value, onChange, placeholder, type = "text" }: FieldProps) {
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
    </label>
  );
}

function MutationError({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : "Unknown error";
  return (
    <p className="rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger">
      {msg}
    </p>
  );
}

/**
 * Renders the username/password form and the "Forgot password?" link.
 *
 * Does not handle navigation — calls `props.onSuccess` and lets the parent
 * decide the post-login destination. The return target is router state only
 * (`location.state.returnTo`); do not parse it from the query string without
 * a server-side allowlist (open-redirect risk).
 */
export function LoginForm({ onSuccess }: LoginFormProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const login = useLoginMutation();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    login.mutate(
      { username, password },
      {
        onSuccess: (data) => {
          onSuccess(data.login.userId);
        },
      },
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="Username" value={username} onChange={setUsername} placeholder="owner" />
      <Field
        label="Password"
        value={password}
        onChange={setPassword}
        placeholder="password"
        type="password"
      />
      <MutationError error={login.error} />
      <button
        type="submit"
        disabled={login.isPending || !username.trim() || !password.trim()}
        className="w-full rounded-lg bg-rim-accent px-4 py-2.5 text-sm font-medium text-rim-void transition hover:bg-rim-accent-strong disabled:opacity-50"
      >
        {login.isPending ? "Signing in..." : "Log in"}
      </button>
      <Link
        to="/forgot-password"
        className="block text-center text-sm text-rim-text-muted transition hover:text-rim-text"
      >
        Forgot password?
      </Link>
    </form>
  );
}
