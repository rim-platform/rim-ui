import { useEffect, useMemo, useState, useCallback, useRef, memo } from "react";
import { Archive, BellOff, ChevronDown, ChevronRight, Compass, Plus } from "lucide-react";
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
import { Avatar } from "../../../shared/ui/Avatar";
import { cn } from "../../../shared/ui/cn";
import { HoverTooltip } from "../../../shared/ui/HoverTooltip";
import { useKeybindLabel } from "../../commands/hooks/useKeybindLabel";
import { useHoverContextStore } from "../../../shell/state/useHoverContextStore";
import { usePresenceStore } from "../../presence/state/usePresenceStore";
import { useDraftStore } from "../../messages/state/useDraftStore";
import { useMutedStore } from "../state/useMutedStore";
import { queryKeys } from "../../../core/query/keys";
import type { MessagesPage } from "../../messages/api/useMessages";
import {
  ConversationTypeEnum,
  NotificationLevel,
} from "../../../core/graphql/generated/schema-types";
import type { ConversationSummary } from "../types";
import { ChannelIcon } from "./ChannelIcon";
import { LockMark } from "../../e2ee/components/LockMark";
import { BrowseChannelsDialog } from "./BrowseChannelsDialog";

interface ConversationListProps {
  onNewChannel: () => void;
}

export function ConversationList({ onNewChannel }: ConversationListProps) {
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
  usePrefetchMessages(workspaceId, allConversationIds);

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
    } else if (e.key === "Enter" && focusedIndex >= 0) {
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

const ConversationItem = memo(function ConversationItem({
  conv,
  globalIndex,
  selectedId,
  focusedIndex,
  isKeyboardNavigating,
  currentUserId,
  memberLookup,
  select,
  unreadCount,
  isMuted,
}: {
  conv: ConversationSummary;
  globalIndex: number;
  selectedId: string | null;
  focusedIndex: number;
  isKeyboardNavigating: boolean;
  currentUserId: string | undefined;
  memberLookup: ReturnType<typeof useMemberLookup>;
  select: (id: string) => void;
  unreadCount: number;
  isMuted: boolean;
}) {
  const active = conv.id === selectedId;
  const focused = globalIndex === focusedIndex;
  // Conversations that notify about nothing (level NONE or a mute in effect, Track 1.3) are
  // dimmed, and their unread count no longer calls for attention.
  const dimmed = isMuted || conv.effectiveNotificationLevel === NotificationLevel.NONE;
  const emphasizeUnread = unreadCount > 0 && !active && !dimmed;

  // For DMs, show the other user's name instead of "Untitled"
  let displayTitle = conv.title;
  let otherMemberId: string | undefined;
  let otherMemberAvatarUrl: string | null | undefined;
  let otherMemberStatusText: string | null | undefined;
  if (conv.conversationType === ConversationTypeEnum.DIRECT && conv.memberIds.length > 0) {
    otherMemberId = conv.memberIds.find((id) => id !== currentUserId) ?? conv.memberIds[0];
    const otherMember = memberLookup.resolve(otherMemberId);
    otherMemberAvatarUrl = otherMember.avatarUrl;
    otherMemberStatusText = otherMember.statusText;
    if (!displayTitle) {
      displayTitle = otherMember.displayName;
    }
  }

  const presenceStatus = usePresenceStore((s) =>
    otherMemberId ? s.presenceMap[otherMemberId] : undefined,
  );

  const hasDraft = useDraftStore((s) => !!s.drafts[conv.id]);

  const hoverKind =
    conv.conversationType === ConversationTypeEnum.DIRECT ? ("dm" as const) : ("channel" as const);

  // Look up quick-access keybind for this specific channel
  const keystroke = useKeybindLabel("workspace.navigate_to_channel", { conversationId: conv.id });

  const button = (
    <button
      type="button"
      onClick={() => {
        select(conv.id);
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
      }}
      onMouseEnter={() =>
        useHoverContextStore.getState().setTarget({
          kind: hoverKind,
          conversationId: conv.id,
          serverId: conv.serverId,
          label: displayTitle ?? "Untitled",
        })
      }
      onMouseLeave={() => useHoverContextStore.getState().clear()}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition focus-visible:outline-none",
        active
          ? "bg-rim-accent/10 text-rim-accent"
          : "text-rim-text-muted hover:bg-white/5 hover:text-rim-text",
        isKeyboardNavigating &&
          focused &&
          "ring-1 ring-rim-accent ring-offset-1 ring-offset-rim-panel",
      )}
    >
      {conv.conversationType === ConversationTypeEnum.DIRECT ? (
        <Avatar
          url={otherMemberAvatarUrl}
          name={displayTitle ?? "?"}
          userId={otherMemberId ?? ""}
          size="xs"
          presenceStatus={
            presenceStatus === "ONLINE" || presenceStatus === "AWAY" || presenceStatus === "OFFLINE"
              ? presenceStatus
              : null
          }
        />
      ) : (
        <ChannelIcon conversation={conv} className="h-4 w-4 shrink-0" />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1">
          <span
            className={cn(
              "block truncate",
              emphasizeUnread && "font-semibold text-rim-text",
              dimmed && "text-rim-text-faint",
            )}
          >
            {displayTitle ?? "Untitled"}
          </span>
          {conv.encryptedAt && <LockMark className="shrink-0" />}
          {dimmed && <BellOff className="h-3 w-3 shrink-0 text-rim-text-faint" />}
          {hasDraft && !active && (
            <span className="shrink-0 text-[10px] italic text-rim-warm">Draft</span>
          )}
        </span>
        {conv.conversationType === ConversationTypeEnum.DIRECT && otherMemberStatusText && (
          <span className="block truncate text-[10px] text-rim-text-faint">
            {otherMemberStatusText}
          </span>
        )}
      </span>
      {unreadCount > 0 && !active ? (
        <span
          className={cn(
            "ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px]",
            dimmed ? "bg-rim-line text-rim-text-muted" : "bg-rim-accent font-bold text-rim-void",
          )}
        >
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      ) : (
        <span className="ml-auto text-xs text-rim-text-faint">{conv.memberCount}</span>
      )}
    </button>
  );

  return (
    <li role="option" aria-selected={active}>
      {keystroke ? (
        <HoverTooltip
          content={
            <span className="text-xs text-rim-text whitespace-nowrap">
              {displayTitle ?? "Untitled"} ({keystroke})
            </span>
          }
        >
          {button}
        </HoverTooltip>
      ) : (
        button
      )}
    </li>
  );
});
