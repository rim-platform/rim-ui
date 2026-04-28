import { useEffect } from "react";

import { useMyServers } from "../api/useMyServers";
import { useWorkspaceStore } from "../state/useWorkspaceStore";
import { EmptyWorkspaceState } from "./EmptyWorkspaceState";

export function WorkspaceSelector() {
  const { data: servers, isPending, isError } = useMyServers();
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const setWorkspaceId = useWorkspaceStore((s) => s.setWorkspaceId);

  useEffect(() => {
    if (servers && servers.length >= 1 && !workspaceId) {
      setWorkspaceId(servers[0].id);
    }
  }, [servers, workspaceId, setWorkspaceId]);

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-rim-void">
        <p className="text-sm text-rim-text-muted">Loading workspaces...</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-rim-void">
        <p className="text-sm text-rim-danger">Failed to load workspaces.</p>
      </div>
    );
  }

  if (!servers || servers.length === 0) {
    return <EmptyWorkspaceState />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-rim-void p-4">
      <div className="w-full max-w-sm space-y-6">
        <header className="text-center">
          <h1 className="text-2xl font-semibold text-rim-text">Choose a workspace</h1>
          <p className="mt-1 text-sm text-rim-text-muted">
            {servers.length} workspace{servers.length > 1 ? "s" : ""} available
          </p>
        </header>

        <ul className="space-y-2">
          {servers.map((server) => (
            <li key={server.id}>
              <button
                type="button"
                onClick={() => setWorkspaceId(server.id)}
                className="flex w-full items-center gap-3 rounded-xl border border-rim-line bg-rim-panel px-4 py-3 text-left transition hover:border-rim-accent/40 hover:bg-rim-panel-soft"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-rim-accent to-rim-accent text-sm font-bold text-rim-void">
                  {server.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-rim-text">{server.name}</p>
                  <p className="truncate text-xs text-rim-text-faint">{server.id}</p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
