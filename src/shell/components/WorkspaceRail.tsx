import { useState } from "react";
import { Plus } from "lucide-react";

import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";
import { useMyServers } from "../../features/workspaces/api/useMyServers";
import { AddWorkspaceDialog } from "../../features/workspaces/components/AddWorkspaceDialog";
import { cn } from "../../shared/ui/cn";
import { useHoverContextStore } from "../state/useHoverContextStore";

export function WorkspaceRail() {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const setWorkspaceId = useWorkspaceStore((s) => s.setWorkspaceId);
  const { data: servers } = useMyServers();
  const [showCreate, setShowCreate] = useState(false);

  return (
    <aside className="flex w-12 shrink-0 flex-col items-center border-r border-rim-line bg-rim-void py-3 gap-2">
      {servers?.map((server) => {
        const active = server.id === workspaceId;
        return (
          <button
            key={server.id}
            type="button"
            title={server.name}
            onClick={() => setWorkspaceId(server.id)}
            onMouseEnter={() =>
              useHoverContextStore.getState().setTarget({
                kind: "workspace",
                workspaceId: server.id,
                label: server.name,
              })
            }
            onMouseLeave={() => useHoverContextStore.getState().clear()}
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-xl text-sm font-bold transition",
              active
                ? "bg-gradient-to-br from-rim-accent to-rim-accent text-rim-void"
                : "bg-rim-panel-soft text-rim-text-muted hover:bg-white/10 hover:text-rim-text",
            )}
          >
            {server.name.charAt(0).toUpperCase()}
          </button>
        );
      })}

      <div className="mt-auto">
        <button
          type="button"
          title="Add workspace"
          onClick={() => setShowCreate(true)}
          className="flex h-9 w-9 items-center justify-center rounded-xl text-rim-text-muted transition hover:bg-white/10 hover:text-rim-text"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {showCreate && <AddWorkspaceDialog onClose={() => setShowCreate(false)} />}
    </aside>
  );
}
