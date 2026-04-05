import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";

import { useAuthStore } from "../state/useAuthStore";
import { useJoinServerByInviteMutation } from "../../settings/api/useInviteMutations";
import { useLoginMutation } from "../api/useAuthMutations";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useSessionHydration } from "../api/useSessionHydration";
import { cn } from "../../../shared/ui/cn";
import { getGraphqlEndpoint } from "../../../core/graphql/config";
import { useHealthCheck } from "../../system/api/useHealthCheck";

export function JoinPage() {
  const { token } = useParams<{ token: string }>();
  const { isHydrating } = useSessionHydration();
  const session = useAuthStore((s) => s.session);

  if (isHydrating) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-rim-void p-4">
        <p className="text-sm text-rim-text-muted">Restoring session...</p>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-rim-void p-4">
        <p className="text-sm text-rim-danger">Invalid invite link.</p>
      </div>
    );
  }

  if (session) {
    return <JoinAuthenticated token={token} />;
  }

  return <JoinWithRegistration token={token} />;
}

function JoinAuthenticated({ token }: { token: string }) {
  const navigate = useNavigate();
  const joinServer = useJoinServerByInviteMutation();
  const setWorkspaceId = useWorkspaceStore((s) => s.setWorkspaceId);

  function handleJoin() {
    joinServer.mutate(token, {
      onSuccess: (data) => {
        setWorkspaceId(data.joinServerByInvite.serverId);
        navigate("/");
      },
    });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-rim-void p-4">
      <div className="w-full max-w-lg space-y-6">
        <header className="text-center">
          <h1 className="text-2xl font-semibold text-rim-text">RIM</h1>
          <p className="mt-1 text-sm text-rim-text-muted">You have been invited to join a workspace</p>
        </header>

        <div className="rounded-xl border border-rim-line bg-rim-panel p-6">
          <div className="space-y-4">
            <p className="text-sm text-rim-text-muted">
              Click below to accept the invitation and join the workspace.
            </p>
            {joinServer.error && (
              <MutationError error={joinServer.error} />
            )}
            <button
              type="button"
              onClick={handleJoin}
              disabled={joinServer.isPending}
              className="w-full rounded-lg bg-rim-accent px-4 py-2.5 text-sm font-medium text-rim-void transition hover:bg-rim-accent-strong disabled:opacity-50"
            >
              {joinServer.isPending ? "Joining..." : "Join workspace"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function JoinWithRegistration({ token }: { token: string }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const setSession = useAuthStore((s) => s.setSession);
  const setWorkspaceId = useWorkspaceStore((s) => s.setWorkspaceId);
  const login = useLoginMutation();
  const joinServer = useJoinServerByInviteMutation();
  const navigate = useNavigate();
  const [step, setStep] = useState<"register" | "joining">("register");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStep("joining");

    // TODO: Replace with a proper register mutation when available.
    // For now, we login (assuming account was pre-created or registration
    // is handled by the bootstrap flow) and then join via invite.
    login.mutate(
      { username, password },
      {
        onSuccess: (data) => {
          setSession({ userId: data.login.userId });
          joinServer.mutate(token, {
            onSuccess: (joinData) => {
              setWorkspaceId(joinData.joinServerByInvite.serverId);
              navigate("/");
            },
            onError: (err) => {
              setStep("register");
              setError(err instanceof Error ? err.message : "Failed to join workspace");
            },
          });
        },
        onError: (err) => {
          setStep("register");
          setError(err instanceof Error ? err.message : "Login failed");
        },
      },
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-rim-void p-4">
      <div className="w-full max-w-lg space-y-6">
        <header className="text-center">
          <h1 className="text-2xl font-semibold text-rim-text">RIM</h1>
          <p className="mt-1 text-sm text-rim-text-muted">Sign in to accept your invitation</p>
        </header>

        <HealthIndicator />

        <div className="rounded-xl border border-rim-line bg-rim-panel p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="Username" value={username} onChange={setUsername} placeholder="username" />
            <Field label="Password" value={password} onChange={setPassword} placeholder="password" type="password" />
            {error && <MutationError error={error} />}
            <button
              type="submit"
              disabled={step === "joining" || !username.trim() || !password.trim()}
              className="w-full rounded-lg bg-rim-accent px-4 py-2.5 text-sm font-medium text-rim-void transition hover:bg-rim-accent-strong disabled:opacity-50"
            >
              {step === "joining" ? "Joining..." : "Sign in & join"}
            </button>
          </form>
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

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-rim-text-faint">{label}</span>
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
  const msg = typeof error === "string" ? error : error instanceof Error ? error.message : "Unknown error";

  return (
    <p className="rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger">
      {msg}
    </p>
  );
}
