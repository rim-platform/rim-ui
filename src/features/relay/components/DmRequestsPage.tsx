import { X } from "lucide-react";

import { useShellStore } from "../../../shell/state/useShellStore";
import { useWorkspace } from "../../workspaces/api/useWorkspace";
import { usePendingDmRequestsIn } from "../api/useDmRequests";
import { DmRequestInbox } from "./DmRequestInbox";

interface DmRequestsPageProps {
  /** The workspace whose requests are shown; `null` for those from outside every workspace. */
  workspaceId: string | null;
}

/** The main area's message requests of one workspace, or of the world outside them. */
export function DmRequestsPage({ workspaceId }: DmRequestsPageProps) {
  const setMainSurface = useShellStore((s) => s.setMainSurface);
  const { data: workspace } = useWorkspace(workspaceId ?? undefined);
  const count = usePendingDmRequestsIn(workspaceId).length;
  const subtitle = workspaceId
    ? `From members of ${workspace?.name ?? "this workspace"}. Their conversations wait here until you accept them.`
    : "From people who share no workspace with you. Nothing they send reaches your conversations until you accept it.";

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 items-center justify-between border-b border-rim-line px-4">
        <h1 className="text-sm font-medium text-rim-text">Message requests</h1>
        <button
          type="button"
          onClick={() => setMainSurface({ kind: "conversation" })}
          title="Close message requests"
          aria-label="Close message requests"
          className="rounded-lg p-1 text-rim-text-muted transition hover:bg-white/5 hover:text-rim-text"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-3 px-6 py-5">
          <p className="text-sm text-rim-text-muted">{subtitle}</p>
          {count === 0 ? (
            <p className="text-sm text-rim-text-muted">No requests wait for you here.</p>
          ) : (
            <DmRequestInbox workspaceId={workspaceId} />
          )}
        </div>
      </div>
    </div>
  );
}
