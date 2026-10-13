import { useState } from "react";
import { MessagesSquare, Plus } from "lucide-react";

import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";
import { useMyServers } from "../../features/workspaces/api/useMyServers";
import { AddWorkspaceDialog } from "../../features/workspaces/components/AddWorkspaceDialog";
import { ownerName, workspaceLabels } from "../../features/workspaces/workspaceLabel";
import { useIsDirectSpace, useRelayStore } from "../../features/relay/state/useRelayStore";
import { useDirectSpaceIds } from "../../features/relay/api/useDirectInbox";
import { unreadTotal, useUnreadStore } from "../../features/conversations/state/useUnreadStore";
import { cn } from "../../shared/ui/cn";
import { handleVerticalStripKeys } from "../../shared/ui/focusNavigation";
import { useHoverContextStore } from "../state/useHoverContextStore";
import { useShellStore } from "../state/useShellStore";

/** The unread count over a rail button. */
function UnreadBadge({ count }: { count: number }) {
  return (
    <span
      aria-hidden
      className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rim-danger px-1 text-[10px] font-bold leading-none text-rim-text"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

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
      ownerName: space.ownerName,
      origin: origins[space.hostServerId] ?? space.hostServerId,
    }));
  const workspaces = [
    ...(servers ?? []).map((server) => ({
      id: server.id,
      name: server.name,
      ownerName: ownerName(server.owner),
    })),
    ...elsewhere,
  ];
  const labels = workspaceLabels(workspaces);
  const inDirectSpace = useIsDirectSpace(workspaceId);
  const directSpaceIds = useDirectSpaceIds();
  const directUnread = useUnreadStore((s) =>
    unreadTotal(s.counts, s.spaceOf, (space) => directSpaceIds.includes(space)),
  );
  const counts = useUnreadStore((s) => s.counts);
  const spaceOf = useUnreadStore((s) => s.spaceOf);

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
          aria-label={
            directUnread > 0 ? `Direct messages (${directUnread} unread)` : "Direct messages"
          }
          aria-pressed={inDirectSpace}
          onClick={() => setWorkspaceId(directSpaceId)}
          className={cn(
            "relative flex h-9 w-9 items-center justify-center rounded-xl transition",
            inDirectSpace
              ? "bg-gradient-to-br from-rim-accent to-rim-accent text-rim-void"
              : "bg-rim-panel-soft text-rim-text-muted hover:bg-white/10 hover:text-rim-text",
          )}
        >
          <MessagesSquare className="h-4 w-4" />
          {directUnread > 0 && <UnreadBadge count={directUnread} />}
        </button>
      )}

      {workspaces.map((server, index) => {
        const active = server.id === workspaceId;
        const label = labels[index];
        // The open workspace's unread messages are on the Inbox button instead.
        const unread = active ? 0 : unreadTotal(counts, spaceOf, (space) => space === server.id);
        return (
          <button
            key={server.id}
            type="button"
            title={label}
            aria-label={unread > 0 ? `${label} (${unread} unread)` : label}
            aria-pressed={active}
            onClick={() => setWorkspaceId(server.id)}
            onMouseEnter={() =>
              useHoverContextStore.getState().setTarget({
                kind: "workspace",
                workspaceId: server.id,
                label,
              })
            }
            onMouseLeave={() => useHoverContextStore.getState().clear()}
            className={cn(
              "relative flex h-9 w-9 items-center justify-center rounded-xl text-sm font-bold transition",
              active
                ? "bg-gradient-to-br from-rim-accent to-rim-accent text-rim-void"
                : "bg-rim-panel-soft text-rim-text-muted hover:bg-white/10 hover:text-rim-text",
            )}
          >
            {server.name.charAt(0).toUpperCase()}
            {unread > 0 && <UnreadBadge count={unread} />}
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
