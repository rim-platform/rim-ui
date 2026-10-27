import { useCallback, useState } from "react";
import { MessagesSquare, Plus } from "lucide-react";

import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";
import { useMyServers } from "../../features/workspaces/api/useMyServers";
import { AddWorkspaceDialog } from "../../features/workspaces/components/AddWorkspaceDialog";
import { ownerName, workspaceLabels } from "../../features/workspaces/workspaceLabel";
import { useIsDirectSpace, useRelayStore } from "../../features/relay/state/useRelayStore";
import { useDirectSpaceIds } from "../../features/relay/api/useDirectInbox";
import { unreadTotal, useUnreadStore } from "../../features/conversations/state/useUnreadStore";
import { BrowseChannelsDialog } from "../../features/conversations/components/BrowseChannelsDialog";
import { NewChannelDialog } from "../../features/conversations/components/NewChannelDialog";
import { InviteDialog } from "../../features/settings/components/InviteDialog";
import {
  useWorkspaceMenuItems,
  type WorkspaceMenuDialog,
} from "../../features/workspaces/hooks/useWorkspaceMenuItems";
import { cn } from "../../shared/ui/cn";
import {
  useContextMenu,
  type ContextMenuController,
} from "../../shared/ui/contextMenu/useContextMenu";
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
  const contextMenu = useContextMenu();
  const [dialog, setDialog] = useState<{ kind: WorkspaceMenuDialog; workspaceId: string } | null>(
    null,
  );
  const closeDialog = useCallback(() => setDialog(null), []);

  return (
    <>
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
            <WorkspaceRailButton
              key={server.id}
              workspaceId={server.id}
              name={server.name}
              label={label}
              unread={unread}
              active={active}
              onSelect={() => setWorkspaceId(server.id)}
              bindMenu={contextMenu.bind}
              onOpenDialog={(kind) => setDialog({ kind, workspaceId: server.id })}
            />
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
      {contextMenu.menu}
      {dialog?.kind === "invite" && (
        <InviteDialog open workspaceId={dialog.workspaceId} onClose={closeDialog} />
      )}
      {dialog?.kind === "browse-channels" && (
        <BrowseChannelsDialog workspaceId={dialog.workspaceId} onClose={closeDialog} />
      )}
      {dialog?.kind === "create-channel" && (
        <NewChannelDialog workspaceId={dialog.workspaceId} onClose={closeDialog} />
      )}
    </>
  );
}

/**
 * A workspace's button on the rail, with the workspace's context menu. The role and settings
 * the menu needs load once the pointer, a finger or the focus reaches the button.
 */
function WorkspaceRailButton({
  workspaceId,
  name,
  label,
  unread,
  active,
  onSelect,
  bindMenu,
  onOpenDialog,
}: {
  workspaceId: string;
  name: string;
  label: string;
  unread: number;
  active: boolean;
  onSelect: () => void;
  bindMenu: ContextMenuController["bind"];
  onOpenDialog: (dialog: WorkspaceMenuDialog) => void;
}) {
  const [reached, setReached] = useState(false);
  const getItems = useWorkspaceMenuItems({
    workspaceId,
    label,
    // The open workspace's menu data loads with the rail, so its first menu is complete.
    enabled: reached || active,
    onOpenDialog,
  });
  const menu = bindMenu(getItems, { label: `${label} actions` });

  return (
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
      {name.charAt(0).toUpperCase()}
      {unread > 0 && <UnreadBadge count={unread} />}
    </button>
  );
}
