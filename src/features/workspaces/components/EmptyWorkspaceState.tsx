/**
 * `EmptyWorkspaceState`: the welcome screen `WorkspaceSelector` shows when the signed-in account
 * belongs to no workspace.
 *
 * "+ Create workspace" opens `CreateWorkspaceDialog`; "Join with an invite code" opens
 * `AddWorkspaceDialog` on its join form. Either dialog sets the workspace on success, and
 * `AppShell` then renders that workspace.
 */

import { useState } from "react";

import { AddWorkspaceDialog } from "./AddWorkspaceDialog";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";

/**
 * Full-screen welcome that offers to create a first workspace or join one with an invite code.
 */
export function EmptyWorkspaceState() {
  const [dialog, setDialog] = useState<"create" | "join" | null>(null);

  return (
    <>
      <div className="flex min-h-screen items-center justify-center bg-rim-void p-4">
        <div className="w-full max-w-sm space-y-6 text-center">
          <header>
            <h1 className="text-2xl font-semibold text-rim-text">Welcome to RIM</h1>
          </header>

          <div className="rounded-xl border border-rim-line bg-rim-panel p-6 space-y-4">
            <p className="text-sm text-rim-text-muted">You don't belong to any workspaces yet.</p>
            <div className="space-y-3">
              <p className="text-sm text-rim-text-faint">Create your first workspace</p>
              <button
                type="button"
                onClick={() => setDialog("create")}
                className="w-full rounded-lg bg-rim-accent px-4 py-2.5 text-sm font-medium text-rim-void transition hover:bg-rim-accent-strong"
              >
                + Create workspace
              </button>
              <button
                type="button"
                onClick={() => setDialog("join")}
                className="w-full rounded-lg border border-rim-line px-4 py-2.5 text-sm font-medium text-rim-text transition hover:border-rim-accent/40 hover:bg-rim-panel-soft"
              >
                Join with an invite code
              </button>
            </div>
          </div>

          <p className="text-xs text-rim-text-faint">
            No invite yet? Ask a workspace&apos;s Owner for an invite link.
          </p>
        </div>
      </div>

      {dialog === "create" && <CreateWorkspaceDialog onClose={() => setDialog(null)} />}
      {dialog === "join" && (
        <AddWorkspaceDialog initialStep="join" onClose={() => setDialog(null)} />
      )}
    </>
  );
}
