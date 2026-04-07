import { useEffect, useMemo, useState, useCallback, useRef, memo } from "react";
import { Hash, MessageCircle, Plus, Users, BellOff } from "lucide-react";

import { useChannels } from "../api/useChannels";
import { useInboxConversations } from "../api/useInboxConversations";
import { useMarkAsRead } from "../api/useMarkAsRead";
import { useUnreadStore } from "../state/useUnreadStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useMemberLookup } from "../../workspaces/hooks/useMemberLookup";
import { usePrefetchMessages } from "../../../core/events/usePrefetchMessages";
import { Avatar } from "../../../shared/ui/Avatar";
import { cn } from "../../../shared/ui/cn";
import { HoverTooltip } from "../../../shared/ui/HoverTooltip";
import { useKeybindLabel } from "../../commands/hooks/useKeybindLabel";
import { useHoverContextStore } from "../../../shell/state/useHoverContextStore";
import { usePresenceStore } from "../../presence/state/usePresenceStore";
import { useDraftStore } from "../../messages/state/useDraftStore";
import { useMutedStore } from "../state/useMutedStore";
type ConversationTypeEnum = "CHANNEL" | "DIRECT" | "GROUP";

const typeIcon: Record<ConversationTypeEnum, typeof Hash> = {
  CHANNEL: Hash,
  DIRECT: MessageCircle,
  GROUP: Users,
};

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
  const { mutate: markAsRead } = useMarkAsRead();

  // Auto mark-as-read when selecting a conversation
  // Use ref to avoid re-render loop (markAsRead changes identity on every render)
  const markAsReadRef = useRef(markAsRead);
  markAsReadRef.current = markAsRead;
  useEffect(() => {
    if (!selectedId || !workspaceId) return;
    const count = useUnreadStore.getState().counts[selectedId];
    if (count) {
      markAsReadRef.current({
        conversationId: selectedId,
        workspaceId,
        readAt: new Date().toISOString(),
      });
    }
  }, [selectedId, workspaceId]);

  const {
    data: channelsData,
    isPending: channelsPending,
    isError: channelsError,
  } = useChannels(workspaceId ?? undefined);

  const {
    data: inboxData,
    isPending: inboxPending,
    isError: inboxError,
  } = useInboxConversations(workspaceId ?? undefined);

  const channels = channelsData?.items ?? [];
  const messages = inboxData?.items ?? [];

  const allItems = useMemo(
    () => [...channels, ...messages],
    [channels, messages],
  );

  const allConversationIds = useMemo(
    () => allItems.map((c) => c.id),
    [allItems],
  );
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
      // Blur the currently focused button so the browser's :focus-visible
      // outline (from globals.css) doesn't linger on the old item.
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      select(id);
    }
  }

  if (channelsPending && inboxPending) {
    return <p className="px-2 py-4 text-sm text-rim-text-muted">Loading conversations...</p>;
  }

  if (channelsError || inboxError) {
    return <p className="px-2 py-4 text-sm text-rim-danger">Failed to load conversations.</p>;
  }

  if (channels.length === 0 && messages.length === 0) {
    return <p className="px-2 py-4 text-sm text-rim-text-muted">No conversations yet.</p>;
  }

  // Compute the global index offset for messages section
  const channelCount = channels.length;

  return (
    <div
      className="space-y-4"
      tabIndex={0}
      role="listbox"
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
      onBlur={() => { setIsKeyboardNavigating(false); setFocusedIndex(-1); }}
      onMouseDown={() => { setIsKeyboardNavigating(false); setFocusedIndex(-1); }}
    >
      {channels.length > 0 && (
        <div>
          <div className="flex items-center justify-between px-2 pb-1">
            <h3 className="text-[11px] font-medium uppercase tracking-wider text-rim-text-faint">
              Channels
            </h3>
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
                globalIndex={channelCount + i}
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
  conv: { id: string; serverId: string; conversationType: string; title: string; memberIds: string[] };
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
  const Icon = typeIcon[conv.conversationType as ConversationTypeEnum] ?? Hash;
  const active = conv.id === selectedId;
  const focused = globalIndex === focusedIndex;

  // For DMs, show the other user's name instead of "Untitled"
  let displayTitle = conv.title;
  let otherMemberId: string | undefined;
  let otherMemberAvatarUrl: string | null | undefined;
  let otherMemberStatusText: string | null | undefined;
  if (conv.conversationType === "DIRECT" && conv.memberIds.length > 0) {
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

  const hoverKind = conv.conversationType === "DIRECT" ? "dm" as const : "channel" as const;

  // Look up quick-access keybind for this specific channel
  const keystroke = useKeybindLabel("workspace.navigate_to_channel", { conversationId: conv.id });

  const button = (
    <button
      type="button"
      onClick={() => {
        select(conv.id);
        // If in navigation mode, refocus the message list so j/k keeps working
        requestAnimationFrame(() => {
          if (useShellStore.getState().navigationMode) {
            document.querySelector<HTMLDivElement>("[data-message-list]")?.focus();
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
        isKeyboardNavigating && focused && "ring-1 ring-rim-accent ring-offset-1 ring-offset-rim-panel",
      )}
    >
      {conv.conversationType === "DIRECT" ? (
        <Avatar
          url={otherMemberAvatarUrl}
          name={displayTitle ?? "?"}
          userId={otherMemberId ?? ""}
          size="xs"
          presenceStatus={presenceStatus === "ONLINE" || presenceStatus === "AWAY" || presenceStatus === "OFFLINE" ? presenceStatus : null}
        />
      ) : (
        <Icon className="h-4 w-4 shrink-0" />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1">
          <span className={cn("block truncate", unreadCount > 0 && !active && "font-semibold text-rim-text", isMuted && "text-rim-text-faint")}>{displayTitle ?? "Untitled"}</span>
          {isMuted && (
            <BellOff className="h-3 w-3 shrink-0 text-rim-text-faint" />
          )}
          {hasDraft && !active && (
            <span className="shrink-0 text-[10px] italic text-rim-warm">Draft</span>
          )}
        </span>
        {conv.conversationType === "DIRECT" && otherMemberStatusText && (
          <span className="block truncate text-[10px] text-rim-text-faint">{otherMemberStatusText}</span>
        )}
      </span>
      {unreadCount > 0 && !active ? (
        <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-rim-accent px-1.5 text-[10px] font-bold text-rim-void">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      ) : (
        <span className="ml-auto text-xs text-rim-text-faint">{conv.memberIds.length}</span>
      )}
    </button>
  );

  return (
    <li role="option" aria-selected={active}>
      {keystroke ? (
        <HoverTooltip content={<span className="text-xs text-rim-text whitespace-nowrap">{displayTitle ?? "Untitled"} ({keystroke})</span>}>
          {button}
        </HoverTooltip>
      ) : (
        button
      )}
    </li>
  );
});
