/**
 * `EmptyWorkspaceState` — shown in the `WorkspaceSelector` when the
 * authenticated user has no workspace memberships.
 *
 * The "Create your first workspace" button opens `CreateWorkspaceDialog`; on
 * success the dialog calls `setWorkspaceId` and `AppShell` re-renders into the
 * full workspace shell.
 *
 * This component is a state branch inside `WorkspaceSelector.tsx`, not a
 * separate route.
 */

import { useState } from "react";

import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";

/**
 * Full-screen empty state prompting the user to create their first workspace.
 *
 * Opens `CreateWorkspaceDialog` on button click. No props — all state is local.
 */
export function EmptyWorkspaceState() {
  const [showDialog, setShowDialog] = useState(false);

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
                onClick={() => setShowDialog(true)}
                className="w-full rounded-lg bg-rim-accent px-4 py-2.5 text-sm font-medium text-rim-void transition hover:bg-rim-accent-strong"
              >
                + Create workspace
              </button>
            </div>
          </div>

          <p className="text-xs text-rim-text-faint">Or ask a teammate to invite you.</p>
        </div>
      </div>

      {showDialog && <CreateWorkspaceDialog onClose={() => setShowDialog(false)} />}
    </>
  );
}
