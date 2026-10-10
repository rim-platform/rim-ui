import { useState } from "react";
import { MessagesSquare, Plus } from "lucide-react";

import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";
import { useMyServers } from "../../features/workspaces/api/useMyServers";
import { AddWorkspaceDialog } from "../../features/workspaces/components/AddWorkspaceDialog";
import { useRelayStore } from "../../features/relay/state/useRelayStore";
import { cn } from "../../shared/ui/cn";
import { handleVerticalStripKeys } from "../../shared/ui/focusNavigation";
import { useHoverContextStore } from "../state/useHoverContextStore";
import { useShellStore } from "../state/useShellStore";

export function WorkspaceRail() {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const setWorkspaceId = useWorkspaceStore((s) => s.setWorkspaceId);
  const { data: servers } = useMyServers();
  const [showCreate, setShowCreate] = useState(false);
  const directSpaceId = useRelayStore((s) => s.info?.directSpaceId ?? null);
  const remoteSpaces = useRelayStore((s) => s.spaces);
  const origins = useRelayStore((s) => s.origins);
  const forked = useRelayStore((s) => s.forked);
  const elsewhere = Object.values(remoteSpaces)
    .filter((space) => space.kind === "workspace" && !forked.includes(space.hostServerId))
    .map((space) => ({
      id: space.spaceId,
      name: space.name ?? "Workspace",
      where: origins[space.hostServerId] ?? space.hostServerId,
    }));
  const inDirectSpace = useRelayStore(
    (s) =>
      Boolean(workspaceId) &&
      (s.info?.directSpaceId === workspaceId || s.spaces[workspaceId ?? ""]?.kind === "direct"),
  );

  return (
    <aside
      data-panel="workspaceRail"
      tabIndex={-1}
      onFocus={() => useShellStore.getState().setFocusedSurface("workspaceRail")}
      onKeyDown={handleVerticalStripKeys}
      className="flex w-12 shrink-0 flex-col items-center border-r border-rim-line bg-rim-void py-3 gap-2 outline-none"
    >
      {directSpaceId && (
        <button
          type="button"
          title="Direct messages"
          aria-label="Direct messages"
          aria-pressed={inDirectSpace}
          onClick={() => setWorkspaceId(directSpaceId)}
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-xl transition",
            inDirectSpace
              ? "bg-gradient-to-br from-rim-accent to-rim-accent text-rim-void"
              : "bg-rim-panel-soft text-rim-text-muted hover:bg-white/10 hover:text-rim-text",
          )}
        >
          <MessagesSquare className="h-4 w-4" />
        </button>
      )}

      {[
        ...(servers ?? []).map((server) => ({ ...server, where: null as string | null })),
        ...elsewhere,
      ].map((server) => {
        const active = server.id === workspaceId;
        return (
          <button
            key={server.id}
            type="button"
            title={server.where ? `${server.name} (on ${server.where})` : server.name}
            aria-label={server.where ? `${server.name} (on ${server.where})` : server.name}
            aria-pressed={active}
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
          aria-label="Add workspace"
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
