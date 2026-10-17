import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";

import { useResetPasswordMutation } from "../api/usePasswordResetMutations";
import { cn } from "../../../shared/ui/cn";
import { getGraphqlEndpoint } from "../../../core/graphql/config";
import { useHealthCheck } from "../../system/api/useHealthCheck";
import { BrandHeading } from "./BrandHeading";

/**
 * Injects `<meta name="referrer" content="no-referrer">` into `document.head`
 * on mount and removes it on unmount. Used on routes that carry sensitive tokens
 * in their URL path to prevent token leakage via the Referer header.
 */
function useNoReferrerMeta(): void {
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "referrer";
    meta.content = "no-referrer";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);
}

export function ResetPasswordPage() {
  useNoReferrerMeta();
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const resetPassword = useResetPasswordMutation();
  const [success, setSuccess] = useState(false);

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-rim-void p-4">
        <p className="text-sm text-rim-danger">Invalid reset link.</p>
      </div>
    );
  }

  const passwordsMatch = newPassword === confirmPassword;
  const canSubmit = newPassword.trim().length > 0 && passwordsMatch && !resetPassword.isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    resetPassword.mutate(
      { token: token!, newPassword },
      {
        onSuccess: () => {
          setSuccess(true);
          setTimeout(() => navigate("/"), 2000);
        },
      },
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-rim-void p-4">
      <div className="w-full max-w-lg space-y-6">
        <header className="text-center">
          <BrandHeading />
          <p className="mt-1 text-sm text-rim-text-muted">Set a new password</p>
        </header>

        <HealthIndicator />

        <div className="rounded-xl border border-rim-line bg-rim-panel p-6">
          {success ? (
            <div className="space-y-4">
              <p className="text-sm text-rim-success">
                Password has been reset successfully. Redirecting to login...
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-rim-text-faint">
                  New password
                </span>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.currentTarget.value)}
                  placeholder="new password"
                  className="w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2.5 text-sm text-rim-text outline-none transition placeholder:text-rim-text-faint focus:border-rim-accent/40"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-rim-text-faint">
                  Confirm password
                </span>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.currentTarget.value)}
                  placeholder="confirm password"
                  className="w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2.5 text-sm text-rim-text outline-none transition placeholder:text-rim-text-faint focus:border-rim-accent/40"
                />
              </label>
              {confirmPassword && !passwordsMatch && (
                <p className="text-xs text-rim-danger">Passwords do not match</p>
              )}
              {resetPassword.error && (
                <p className="rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger">
                  {resetPassword.error instanceof Error
                    ? resetPassword.error.message
                    : "Failed to reset password"}
                </p>
              )}
              <button
                type="submit"
                disabled={!canSubmit}
                className="w-full rounded-lg bg-rim-accent px-4 py-2.5 text-sm font-medium text-rim-void transition hover:bg-rim-accent-strong disabled:opacity-50"
              >
                {resetPassword.isPending ? "Resetting..." : "Reset password"}
              </button>
              <Link
                to="/"
                className="block text-center text-sm text-rim-text-muted transition hover:text-rim-text"
              >
                Back to login
              </Link>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function HealthIndicator() {
  const { isSuccess, isError } = useHealthCheck();
  const color = isSuccess ? "bg-rim-success" : isError ? "bg-rim-danger" : "bg-rim-warm";
  const label = isSuccess ? "Backend reachable" : isError ? "Backend unreachable" : "Connecting...";

  return (
    <div className="flex items-center justify-center gap-2 text-xs text-rim-text-muted">
      <span className={cn("inline-block h-2 w-2 rounded-full", color)} />
      <span>{label}</span>
      <span className="text-rim-text-faint">({getGraphqlEndpoint()})</span>
    </div>
  );
}
