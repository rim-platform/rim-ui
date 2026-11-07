import { useMemo, useState, useCallback } from "react";
import { Archive, ChevronDown, ChevronRight, Compass, Plus } from "lucide-react";

import { useJoinedChannels } from "../api/useChannels";
import { useInboxConversations } from "../api/useInboxConversations";
import { useUnreadStore } from "../state/useUnreadStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useMemberLookup } from "../../workspaces/hooks/useMemberLookup";
import { useIsGuest, useMyServerRole } from "../../workspaces/api/useMyServerRole";
import { useIsDefaultWorkspace } from "../../workspaces/hooks/useIsDefaultWorkspace";
import { canCreateChannel } from "../../workspaces/role";
import { usePrefetchMessages } from "../../../core/events/usePrefetchMessages";
import type { DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import { isContextMenuKey, useContextMenu } from "../../../shared/ui/contextMenu/useContextMenu";
import { useMutedStore } from "../state/useMutedStore";
import { usePendingDmRequestsIn } from "../../relay/api/useDmRequests";
import { DmRequestsRow } from "../../relay/components/DmRequestsRow";
import { useIsDirectSpace } from "../../relay/state/useRelayStore";
import { useConversationMenuItems } from "../hooks/useConversationMenuItems";
import type { ConversationSummary } from "../types";
import { conversationRowIn, isInvited } from "../utils";
import { BrowseChannelsDialog } from "./BrowseChannelsDialog";
import { ConversationItem } from "./ConversationItem";
import { WorkspaceBotsSection } from "../../bots/components/WorkspaceBotsSection";
import { DirectConversationList } from "./DirectConversationList";
import { DraftDirectItem } from "./DraftDirectItem";

interface ConversationListProps {
  onNewChannel: () => void;
}

const ROW_MENU = { label: "Conversation actions" };

/**
 * The conversation list: a workspace's channels and DMs, or, in a direct space, the
 * DMs and groups of every direct space this account uses.
 */
export function ConversationList(props: ConversationListProps) {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const direct = useIsDirectSpace(workspaceId);
  return direct ? <DirectConversationList /> : <WorkspaceConversationList {...props} />;
}

function WorkspaceConversationList({ onNewChannel }: ConversationListProps) {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const selectedId = useShellStore((s) => s.selectedConversationId);
  const setSelected = useShellStore((s) => s.setSelectedConversationId);
  // A conversation the person chooses closes the navigation drawer of a narrow window, even
  // when it is the one already open.
  const select = useCallback<typeof setSelected>(
    (id, options) => {
      setSelected(id, options);
      useShellStore.getState().setNavDrawerOpen(false);
    },
    [setSelected],
  );
  const draftDirect = useShellStore((s) => s.draftDirect);
  const draft =
    draftDirect && "workspaceId" in draftDirect && draftDirect.workspaceId === workspaceId
      ? draftDirect
      : null;
  const currentUserId = useAuthStore((s) => s.session?.userId);
  const memberLookup = useMemberLookup(workspaceId ?? undefined);
  const unreadCounts = useUnreadStore((s) => s.counts);
  const allUnread = Object.values(unreadCounts).reduce((total, count) => total + count, 0);
  const mutedIds = useMutedStore((s) => s.mutedIds);
  // Guests cannot browse, join or create channels; the server refuses anyway.
  const isGuest = useIsGuest(workspaceId ?? undefined);
  // In the server's default workspace only the Owner and Moderators create channels.
  const role = useMyServerRole(workspaceId ?? undefined);
  const canCreate = canCreateChannel(role, useIsDefaultWorkspace(workspaceId));
  // Requests for DMs of this workspace, kept out of its conversations until accepted.
  const scopedRequests = usePendingDmRequestsIn(workspaceId ?? undefined);
  const requestCount = workspaceId ? scopedRequests.length : 0;
  const contextMenu = useContextMenu();
  const { bind: bindContextMenu, openUnder } = contextMenu;
  const { getItems: conversationMenuItems, dialogs: conversationDialogs } =
    useConversationMenuItems(workspaceId);
  const bindRowMenu = useCallback(
    (conv: ConversationSummary, label: string) =>
      bindContextMenu(() => conversationMenuItems(conv, { label }), ROW_MENU),
    [bindContextMenu, conversationMenuItems],
  );

  const {
    data: channelsData,
    isPending: channelsPending,
    isError: channelsError,
  } = useJoinedChannels(workspaceId ?? undefined);

  const {
    data: inboxData,
    isPending: inboxPending,
    isError: inboxError,
  } = useInboxConversations(workspaceId ?? undefined);

  // The sidebar lists joined channels; archived ones sit in a collapsed "Archived" group that
  // only renders when there is something in it.
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);
  const { channels, archivedChannels } = useMemo(() => {
    const items = channelsData?.items ?? [];
    return {
      channels: items.filter((c) => !c.isArchived),
      archivedChannels: items.filter((c) => c.isArchived),
    };
  }, [channelsData]);
  const messages = useMemo(() => inboxData?.items ?? [], [inboxData]);
  const visibleArchived = useMemo(
    () => (archivedOpen ? archivedChannels : []),
    [archivedOpen, archivedChannels],
  );

  const allItems = useMemo(
    () => [...channels, ...visibleArchived, ...messages],
    [channels, visibleArchived, messages],
  );

  const allConversationIds = useMemo(() => allItems.map((c) => c.id), [allItems]);
  // The server refuses the messages of a conversation the viewer is only invited to.
  const readableIds = useMemo(
    () => allItems.filter((c) => !isInvited(c, currentUserId)).map((c) => c.id),
    [allItems, currentUserId],
  );
  usePrefetchMessages(workspaceId, readableIds);

  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [isKeyboardNavigating, setIsKeyboardNavigating] = useState(false);

  // When the list gets DOM focus, highlight the currently selected conversation
  const handleFocus = useCallback(() => {
    if (focusedIndex < 0) {
      const idx = allItems.findIndex((item) => item.id === selectedId);
      setFocusedIndex(idx >= 0 ? idx : 0);
    }
  }, [allItems, selectedId, focusedIndex]);

  // Reset focused index when items change
  const [itemCount, setItemCount] = useState(allConversationIds.length);
  if (itemCount !== allConversationIds.length) {
    setItemCount(allConversationIds.length);
    setFocusedIndex(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (isContextMenuKey(e)) {
      // A focused row or header opened its own menu; otherwise the highlighted row's opens.
      if (e.defaultPrevented) return;
      const conv = focusedIndex >= 0 ? allItems[focusedIndex] : undefined;
      const row = conv ? conversationRowIn(e.currentTarget, conv.id) : null;
      if (conv && row && openUnder(row, () => conversationMenuItems(conv), ROW_MENU)) {
        e.preventDefault();
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();

      if (!isKeyboardNavigating) {
        // First keyboard press after mouse — start from currently selected conversation
        const currentIdx = allItems.findIndex((item) => item.id === selectedId);
        const startIdx = currentIdx >= 0 ? currentIdx : 0;

        setIsKeyboardNavigating(true);

        if (e.key === "ArrowDown") {
          setFocusedIndex(Math.min(startIdx + 1, allItems.length - 1));
        } else {
          setFocusedIndex(Math.max(startIdx - 1, 0));
        }
      } else {
        // Already navigating — continue from current position
        if (e.key === "ArrowDown") {
          setFocusedIndex((i) => Math.min(i + 1, allItems.length - 1));
        } else {
          setFocusedIndex((i) => Math.max(i - 1, 0));
        }
      }
    } else if ((e.key === "Home" || e.key === "End") && allItems.length > 0) {
      e.preventDefault();
      setIsKeyboardNavigating(true);
      setFocusedIndex(e.key === "Home" ? 0 : allItems.length - 1);
    } else if (
      e.key === "Enter" &&
      focusedIndex >= 0 &&
      // Enter on a button inside the list (a conversation reached with Tab, "New channel")
      // presses that button; it opens the highlighted row only after arrow keys moved it.
      (isKeyboardNavigating || e.target === e.currentTarget)
    ) {
      e.preventDefault();
      const id = allItems[focusedIndex].id;
      setIsKeyboardNavigating(false);
      setFocusedIndex(-1);
      select(id);
      // Entering a conversation always resets to COMPOSE mode and focuses
      // the composer — mode is a property of the conversation view.
      useShellStore.getState().setNavigationMode(false);
      requestAnimationFrame(() => {
        const composer = document.querySelector<HTMLTextAreaElement>("[data-composer-input]");
        if (composer) {
          composer.focus();
        } else if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      });
    }
  }

  if (channelsPending && inboxPending) {
    return <p className="px-2 py-4 text-sm text-rim-text-muted">Loading conversations...</p>;
  }

  if (channelsError || inboxError) {
    return <p className="px-2 py-4 text-sm text-rim-danger">Failed to load conversations.</p>;
  }

  // Global index offsets for the archived and messages sections (keyboard navigation)
  const archivedOffset = channels.length;
  const messagesOffset = channels.length + visibleArchived.length;

  const channelSectionItems = (): DropdownMenuItem[] =>
    isGuest
      ? []
      : [
          { id: "browse-channels", label: "Browse channels…", onSelect: () => setBrowseOpen(true) },
          ...(canCreate
            ? [{ id: "create-channel", label: "Create channel…", onSelect: () => onNewChannel() }]
            : []),
        ];
  const archivedSectionItems = (): DropdownMenuItem[] => [
    {
      id: "toggle-section",
      label: archivedOpen ? "Collapse section" : "Expand section",
      onSelect: () => setArchivedOpen((v) => !v),
    },
  ];

  return (
    <>
      <div
        className="space-y-4"
        tabIndex={0}
        role="listbox"
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={() => {
          setIsKeyboardNavigating(false);
          setFocusedIndex(-1);
        }}
        onMouseDown={() => {
          setIsKeyboardNavigating(false);
          setFocusedIndex(-1);
        }}
      >
        {allUnread > 0 && (
          <button
            type="button"
            onClick={() => useShellStore.getState().setMainSurface({ kind: "unreads" })}
            className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-rim-text-muted transition hover:bg-white/5 hover:text-rim-text"
          >
            Unreads
            <span className="text-xs text-rim-text-faint">{allUnread}</span>
          </button>
        )}
        <div>
          <div
            {...bindContextMenu(channelSectionItems, { label: "Channels" })}
            className="flex items-center justify-between px-2 pb-1"
          >
            <h3 className="text-[11px] font-medium uppercase tracking-wider text-rim-text-faint">
              Channels
            </h3>
            {!isGuest && (
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => setBrowseOpen(true)}
                  title="Browse channels"
                  aria-label="Browse channels"
                  className="rounded p-0.5 text-rim-text-faint transition hover:bg-white/5 hover:text-rim-text"
                >
                  <Compass className="h-3 w-3" />
                </button>
                {canCreate && (
                  <button
                    type="button"
                    onClick={() => onNewChannel()}
                    title="New channel"
                    aria-label="New channel"
                    className="rounded p-0.5 text-rim-text-faint transition hover:bg-white/5 hover:text-rim-text"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                )}
              </div>
            )}
          </div>
          {channels.length === 0 && isGuest ? (
            <p className="px-2 py-2 text-sm text-rim-text-muted">
              No channels yet. A member can add you to one.
            </p>
          ) : channels.length === 0 ? (
            <button
              type="button"
              onClick={() => setBrowseOpen(true)}
              className="w-full rounded-lg px-2 py-2 text-left text-sm text-rim-text-muted transition hover:bg-white/5 hover:text-rim-text"
            >
              No channels joined yet. Browse channels
            </button>
          ) : (
            <ul className="space-y-0.5">
              {channels.map((conv, i) => (
                <ConversationItem
                  key={conv.id}
                  conv={conv}
                  globalIndex={i}
                  selectedId={selectedId}
                  focusedIndex={focusedIndex}
                  isKeyboardNavigating={isKeyboardNavigating}
                  currentUserId={currentUserId}
                  memberLookup={memberLookup}
                  select={select}
                  unreadCount={unreadCounts[conv.id] ?? 0}
                  isMuted={mutedIds.has(conv.id)}
                  bindMenu={bindRowMenu}
                />
              ))}
            </ul>
          )}
        </div>

        <WorkspaceBotsSection workspaceId={workspaceId} />

        {archivedChannels.length > 0 && (
          <div>
            <button
              type="button"
              {...bindContextMenu(archivedSectionItems, { label: "Archived" })}
              onClick={() => setArchivedOpen((v) => !v)}
              aria-expanded={archivedOpen}
              className="flex w-full items-center gap-1 px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-rim-text-faint transition hover:text-rim-text"
            >
              {archivedOpen ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              <Archive className="h-3 w-3" />
              Archived ({archivedChannels.length})
            </button>
            {archivedOpen && (
              <ul className="space-y-0.5" aria-label="Archived channels">
                {visibleArchived.map((conv, i) => (
                  <ConversationItem
                    key={conv.id}
                    conv={conv}
                    globalIndex={archivedOffset + i}
                    selectedId={selectedId}
                    focusedIndex={focusedIndex}
                    isKeyboardNavigating={isKeyboardNavigating}
                    currentUserId={currentUserId}
                    memberLookup={memberLookup}
                    select={select}
                    unreadCount={unreadCounts[conv.id] ?? 0}
                    isMuted={mutedIds.has(conv.id)}
                    bindMenu={bindRowMenu}
                  />
                ))}
              </ul>
            )}
          </div>
        )}

        {(messages.length > 0 || draft || requestCount > 0) && (
          <div>
            <h3 className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-rim-text-faint">
              Conversations
            </h3>
            {workspaceId && <DmRequestsRow workspaceId={workspaceId} count={requestCount} />}
            <ul className="space-y-0.5">
              {draft && <DraftDirectItem draft={draft} />}
              {messages.map((conv, i) => (
                <ConversationItem
                  key={conv.id}
                  conv={conv}
                  globalIndex={messagesOffset + i}
                  selectedId={selectedId}
                  focusedIndex={focusedIndex}
                  isKeyboardNavigating={isKeyboardNavigating}
                  currentUserId={currentUserId}
                  memberLookup={memberLookup}
                  select={select}
                  unreadCount={unreadCounts[conv.id] ?? 0}
                  isMuted={mutedIds.has(conv.id)}
                  bindMenu={bindRowMenu}
                />
              ))}
            </ul>
          </div>
        )}

        {browseOpen && workspaceId && !isGuest && (
          <BrowseChannelsDialog workspaceId={workspaceId} onClose={() => setBrowseOpen(false)} />
        )}
      </div>
      {contextMenu.menu}
      {conversationDialogs}
    </>
  );
}
