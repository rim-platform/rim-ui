import { useCallback, useEffect, useState } from "react";
import { House, MessagesSquare, Plus } from "lucide-react";

import { runCommandFromClick } from "../../features/commands/runtime/runFromClick";
import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";
import { useMyServers } from "../../features/workspaces/api/useMyServers";
import { ownerName, workspaceLabels } from "../../features/workspaces/workspaceLabel";
import { useIsDirectSpace, useRelayStore } from "../../features/relay/state/useRelayStore";
import { useDirectSpaceIds } from "../../features/relay/api/useDirectInbox";
import { unreadTotal, useUnreadStore } from "../../features/conversations/state/useUnreadStore";
import { useWorkspaceMenuItems } from "../../features/workspaces/hooks/useWorkspaceMenuItems";
import { cn } from "../../shared/ui/cn";
import { useContextMenu } from "../../shared/ui/contextMenu/useContextMenu";
import { handleVerticalStripKeys } from "../../shared/ui/focusNavigation";
import { useHomeMentionCount } from "../../features/home/api/useHomeMentions";
import { useHoverContextStore } from "../state/useHoverContextStore";
import { useShellStore } from "../state/useShellStore";
import { firstLetter } from "../../shared/utils/initials";
import { RailFooter } from "./RailFooter";

/** The unread count over a rail button. */
function UnreadBadge({ count }: { count: number }) {
  return (
    <span
      aria-hidden
      className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rim-danger-solid px-1 text-[10px] font-bold leading-none text-white"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** Whether a main surface spans all workspaces, so no workspace button is current on it. */
function spansWorkspaces(kind: string): boolean {
  return kind === "home" || kind === "unreads";
}

export function WorkspaceRail() {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const openWorkspace = useWorkspaceStore((s) => s.setWorkspaceId);
  // Choosing a workspace on the rail leaves Home and Unreads for it.
  const setWorkspaceId = useCallback(
    (id: string) => {
      openWorkspace(id);
      const shell = useShellStore.getState();
      if (spansWorkspaces(shell.mainSurface.kind)) shell.setMainSurface({ kind: "conversation" });
    },
    [openWorkspace],
  );
  const { data: servers } = useMyServers();
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
  const acrossWorkspaces = useShellStore((s) => spansWorkspaces(s.mainSurface.kind));
  const directSpaceOpen = useIsDirectSpace(workspaceId);
  const inDirectSpace = directSpaceOpen && !acrossWorkspaces;
  const directSpaceIds = useDirectSpaceIds();
  const directUnread = useUnreadStore((s) =>
    unreadTotal(s.counts, s.spaceOf, (space) => directSpaceIds.includes(space)),
  );
  const homeSurface = useShellStore((s) => s.mainSurface.kind === "home");
  const homeCount = useHomeMentionCount();
  const counts = useUnreadStore((s) => s.counts);
  const spaceOf = useUnreadStore((s) => s.spaceOf);

  return (
    <>
      <aside
        data-panel="workspaceRail"
        tabIndex={-1}
        onFocus={() => useShellStore.getState().setFocusedSurface("workspaceRail")}
        onKeyDown={handleVerticalStripKeys}
        className="flex w-12 shrink-0 flex-col items-center gap-2 overflow-y-auto border-r border-rim-line bg-rim-void py-3 outline-none [scrollbar-width:none] *:shrink-0"
      >
        <button
          type="button"
          title="Home"
          aria-label={homeCount > 0 ? `Home (${homeCount} mentions and replies)` : "Home"}
          aria-current={homeSurface ? "page" : undefined}
          onClick={() => void runCommandFromClick("workspace.open_home")}
          className={cn(
            "relative flex h-9 w-9 items-center justify-center rounded-xl transition",
            homeSurface
              ? "bg-gradient-to-br from-rim-accent to-rim-accent text-rim-void"
              : "bg-rim-panel-soft text-rim-text-muted hover:bg-white/10 hover:text-rim-text",
          )}
        >
          <House className="h-4 w-4" />
          {homeCount > 0 && <UnreadBadge count={homeCount} />}
        </button>

        {directSpaceId && (
          <button
            type="button"
            title="Direct messages"
            aria-label={
              directUnread > 0 ? `Direct messages (${directUnread} unread)` : "Direct messages"
            }
            aria-pressed={inDirectSpace}
            onClick={() => void runCommandFromClick("workspace.open_direct_messages")}
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

        {directSpaceId && <div aria-hidden className="h-px w-6 shrink-0 bg-rim-line" />}

        {workspaces.map((server, index) => {
          const active = server.id === workspaceId && !acrossWorkspaces;
          const label = labels[index];
          // The open workspace's unread messages show in its conversation list instead.
          const unread = active ? 0 : unreadTotal(counts, spaceOf, (space) => space === server.id);
          return (
            <WorkspaceRailButton
              key={server.id}
              workspaceId={server.id}
              name={server.name}
              label={label}
              unread={unread}
              active={active}
              onSelect={() => setWorkspaceId(server.id)}
            />
          );
        })}

        <button
          type="button"
          title="Add workspace"
          aria-label="Add workspace"
          onClick={() => void runCommandFromClick("workspace.add")}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-rim-text-muted transition hover:bg-white/10 hover:text-rim-text"
        >
          <Plus className="h-4 w-4" />
        </button>

        <div className="mt-auto pt-2">
          <RailFooter auditLog={Boolean(workspaceId) && !directSpaceOpen && !acrossWorkspaces} />
        </div>
      </aside>
    </>
  );
}

/**
 * A workspace's button on the rail, with the workspace's context menu. The role and settings
 * the menu needs load once the pointer, a finger or the focus reaches the button, and an open
 * menu fills in when they arrive.
 */
function WorkspaceRailButton({
  workspaceId,
  name,
  label,
  unread,
  active,
  onSelect,
}: {
  workspaceId: string;
  name: string;
  label: string;
  unread: number;
  active: boolean;
  onSelect: () => void;
}) {
  const [reached, setReached] = useState(false);
  const getItems = useWorkspaceMenuItems({
    workspaceId,
    // The open workspace's menu data loads with the rail, so its first menu is complete.
    enabled: reached || active,
  });
  const { bind, refresh, menu: openMenu } = useContextMenu();
  const menu = bind(getItems, { label: `${label} actions` });
  // The role and settings may arrive while the menu is open: its items follow them.
  useEffect(() => refresh(getItems), [refresh, getItems]);

  return (
    <>
      <button
        type="button"
        title={label}
        aria-label={unread > 0 ? `${label} (${unread} unread)` : label}
        aria-pressed={active}
        {...menu}
        onClick={onSelect}
        onFocus={() => setReached(true)}
        onTouchStart={(e) => {
          setReached(true);
          menu.onTouchStart(e);
        }}
        onMouseEnter={() => {
          setReached(true);
          useHoverContextStore.getState().setTarget({ kind: "workspace", workspaceId, label });
        }}
        onMouseLeave={() => useHoverContextStore.getState().clear()}
        className={cn(
          "relative flex h-9 w-9 items-center justify-center rounded-xl text-sm font-bold transition",
          active
            ? "bg-gradient-to-br from-rim-accent to-rim-accent text-rim-void"
            : "bg-rim-panel-soft text-rim-text-muted hover:bg-white/10 hover:text-rim-text",
        )}
      >
        {firstLetter(name)}
        {unread > 0 && <UnreadBadge count={unread} />}
      </button>
      {openMenu}
    </>
  );
}
