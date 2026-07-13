import { useState } from "react";
import { Link } from "react-router-dom";

import { useRequestPasswordResetMutation } from "../api/usePasswordResetMutations";
import { cn } from "../../../shared/ui/cn";
import { getGraphqlEndpoint } from "../../../core/graphql/config";
import { useHealthCheck } from "../../system/api/useHealthCheck";

export function ForgotPasswordPage() {
  const [username, setUsername] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const requestReset = useRequestPasswordResetMutation();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    requestReset.mutate(username, {
      onSuccess: () => setSubmitted(true),
      onError: () => {
        // Always show success to avoid leaking account existence
        setSubmitted(true);
      },
    });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-rim-void p-4">
      <div className="w-full max-w-lg space-y-6">
        <header className="text-center">
          <h1 className="text-2xl font-semibold text-rim-text">RIM</h1>
          <p className="mt-1 text-sm text-rim-text-muted">Reset your password</p>
        </header>

        <HealthIndicator />

        <div className="rounded-xl border border-rim-line bg-rim-panel p-6">
          {submitted ? (
            <div className="space-y-4">
              <p className="text-sm text-rim-text-muted">
                If the account exists, a reset link has been sent. Check with your administrator for
                the reset link.
              </p>
              <Link
                to="/"
                className="block w-full rounded-lg bg-rim-accent px-4 py-2.5 text-center text-sm font-medium text-rim-void transition hover:bg-rim-accent-strong"
              >
                Back to login
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-rim-text-faint">
                  Username
                </span>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.currentTarget.value)}
                  placeholder="your username"
                  className="w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2.5 text-sm text-rim-text outline-none transition placeholder:text-rim-text-faint focus:border-rim-accent/40"
                />
              </label>
              <button
                type="submit"
                disabled={requestReset.isPending || !username.trim()}
                className="w-full rounded-lg bg-rim-accent px-4 py-2.5 text-sm font-medium text-rim-void transition hover:bg-rim-accent-strong disabled:opacity-50"
              >
                {requestReset.isPending ? "Sending..." : "Request password reset"}
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
