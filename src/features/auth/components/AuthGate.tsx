import { useState } from "react";

import { useBootstrapMutation, useLoginMutation } from "../api/useAuthMutations";
import { useAuthStore } from "../state/useAuthStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useHealthCheck } from "../../system/api/useHealthCheck";
import { getGraphqlEndpoint } from "../../../core/graphql/config";
import { cn } from "../../../shared/ui/cn";

type Mode = "login" | "bootstrap";

export function AuthGate() {
  const [mode, setMode] = useState<Mode>("login");

  return (
    <div className="flex min-h-screen items-center justify-center bg-rim-void p-4">
      <div className="w-full max-w-lg space-y-6">
        <header className="text-center">
          <h1 className="text-2xl font-semibold text-rim-text">RIM</h1>
          <p className="mt-1 text-sm text-rim-text-muted">Sign in to your workspace</p>
        </header>

        <HealthIndicator />

        <div className="rounded-xl border border-rim-line bg-rim-panel p-6">
          <div className="mb-5 flex gap-2">
            <ModeTab active={mode === "login"} label="Login" onClick={() => setMode("login")} />
            <ModeTab active={mode === "bootstrap"} label="Bootstrap" onClick={() => setMode("bootstrap")} />
          </div>

          {mode === "login" ? <LoginForm /> : <BootstrapForm />}
        </div>

      </div>
    </div>
  );
}

function ModeTab({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg px-3 py-1.5 text-sm font-medium transition",
        active ? "bg-rim-accent/15 text-rim-accent" : "text-rim-text-muted hover:text-rim-text",
      )}
    >
      {label}
    </button>
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

function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const setSession = useAuthStore((s) => s.setSession);
  const login = useLoginMutation();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    login.mutate(
      { username, password },
      {
        onSuccess: (data) => {
          setSession({ userId: data.login.userId });
        },
      },
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="Username" value={username} onChange={setUsername} placeholder="owner" />
      <Field label="Password" value={password} onChange={setPassword} placeholder="password" type="password" />
      <MutationError error={login.error} />
      <button
        type="submit"
        disabled={login.isPending || !username.trim() || !password.trim()}
        className="w-full rounded-lg bg-rim-accent px-4 py-2.5 text-sm font-medium text-rim-void transition hover:bg-rim-accent-strong disabled:opacity-50"
      >
        {login.isPending ? "Signing in..." : "Log in"}
      </button>
    </form>
  );
}

function BootstrapForm() {
  const [secret, setSecret] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [serverName, setServerName] = useState("");
  const setSession = useAuthStore((s) => s.setSession);
  const setWorkspaceId = useWorkspaceStore((s) => s.setWorkspaceId);
  const bootstrap = useBootstrapMutation();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    bootstrap.mutate(
      { secret, username, password, serverName },
      {
        onSuccess: (data) => {
          setSession({ userId: data.bootstrap.userId });
          setWorkspaceId(data.bootstrap.serverId);
        },
      },
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="Bootstrap secret" value={secret} onChange={setSecret} placeholder="secret" type="password" />
      <Field label="Username" value={username} onChange={setUsername} placeholder="admin" />
      <Field label="Password" value={password} onChange={setPassword} placeholder="password" type="password" />
      <Field label="Workspace name" value={serverName} onChange={setServerName} placeholder="My Workspace" />
      <MutationError error={bootstrap.error} />
      <button
        type="submit"
        disabled={bootstrap.isPending || !secret.trim() || !username.trim() || !password.trim() || !serverName.trim()}
        className="w-full rounded-lg bg-rim-warm px-4 py-2.5 text-sm font-medium text-rim-void transition hover:brightness-110 disabled:opacity-50"
      >
        {bootstrap.isPending ? "Bootstrapping..." : "Bootstrap instance"}
      </button>
    </form>
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
  const msg = error instanceof Error ? error.message : "Unknown error";

  return (
    <p className="rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger">
      {msg}
    </p>
  );
}
