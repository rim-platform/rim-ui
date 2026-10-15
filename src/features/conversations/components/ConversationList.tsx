import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Archive, ChevronDown, ChevronRight, Compass, Plus } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { useJoinedChannels } from "../api/useChannels";
import { useInboxConversations } from "../api/useInboxConversations";
import { useUnreadStore } from "../state/useUnreadStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useMemberLookup } from "../../workspaces/hooks/useMemberLookup";
import { useIsGuest } from "../../workspaces/api/useMyServerRole";
import { usePrefetchMessages } from "../../../core/events/usePrefetchMessages";
import { useMutedStore } from "../state/useMutedStore";
import { queryKeys } from "../../../core/query/keys";
import type { MessagesPage } from "../../messages/api/useMessages";
import { useIsDirectSpace } from "../../relay/state/useRelayStore";
import { isInvited } from "../utils";
import { BrowseChannelsDialog } from "./BrowseChannelsDialog";
import { ConversationItem } from "./ConversationItem";
import { DirectConversationList } from "./DirectConversationList";

interface ConversationListProps {
  onNewChannel: () => void;
}

/**
 * The side rail's conversations: a workspace's channels and DMs, or, in a direct space, the
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
  const select = useShellStore((s) => s.setSelectedConversationId);
  const currentUserId = useAuthStore((s) => s.session?.userId);
  const memberLookup = useMemberLookup(workspaceId ?? undefined);
  const unreadCounts = useUnreadStore((s) => s.counts);
  const mutedIds = useMutedStore((s) => s.mutedIds);
  // Guests cannot browse, join or create channels; the server refuses anyway.
  const isGuest = useIsGuest(workspaceId ?? undefined);
  const qc = useQueryClient();

  // Track the previous conversation so we can snapshot it before switching
  const prevSelectedIdRef = useRef<string | null>(null);

  // Snapshot watermark for the conversation being LEFT, then clear its sidebar unread count optimistically.
  // markAsRead backend call is deferred — it fires only when the divider is dismissed.
  useEffect(() => {
    const prevId = prevSelectedIdRef.current;
    prevSelectedIdRef.current = selectedId;

    if (!prevId || !workspaceId || prevId === selectedId) return;

    // Snapshot the sentAt of the last message in the conversation we're leaving
    const cached = qc.getQueryData<{ pages: MessagesPage[] }>(
      queryKeys.messages(workspaceId, prevId),
    );
    if (cached?.pages && cached.pages.length > 0) {
      // pages are in load order (newest first after our reverse), but getQueryData
      // returns them as stored — first page = newest page (reverse display order).
      // The last item of pages[0] is the newest message in the conversation.
      const newestPage = cached.pages[0];
      const lastItem = newestPage?.items?.[newestPage.items.length - 1];
      if (lastItem?.sentAt) {
        useUnreadStore.getState().setWatermark(prevId, lastItem.sentAt);
      }
    }

    // Optimistically clear the sidebar unread badge for the conversation we left
    useUnreadStore.getState().markRead(prevId);
  }, [selectedId, workspaceId, qc]);

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
  useEffect(() => {
    setFocusedIndex(-1);
  }, [allConversationIds.length]);

  useEffect(() => {
    if (!selectedId) {
      const first = channels[0] ?? messages[0];
      if (first) {
        select(first.id);
      }
    }
  }, [selectedId, channels, messages, select]);

  function handleKeyDown(e: React.KeyboardEvent) {
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

  return (
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
      <div>
        <div className="flex items-center justify-between px-2 pb-1">
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
              <button
                type="button"
                onClick={() => onNewChannel()}
                title="New channel"
                aria-label="New channel"
                className="rounded p-0.5 text-rim-text-faint transition hover:bg-white/5 hover:text-rim-text"
              >
                <Plus className="h-3 w-3" />
              </button>
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
              />
            ))}
          </ul>
        )}
      </div>

      {archivedChannels.length > 0 && (
        <div>
          <button
            type="button"
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
                />
              ))}
            </ul>
          )}
        </div>
      )}

      {messages.length > 0 && (
        <div>
          <h3 className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-rim-text-faint">
            Messages
          </h3>
          <ul className="space-y-0.5">
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
              />
            ))}
          </ul>
        </div>
      )}

      {browseOpen && workspaceId && !isGuest && (
        <BrowseChannelsDialog workspaceId={workspaceId} onClose={() => setBrowseOpen(false)} />
      )}
    </div>
  );
}
