import { useEffect, useMemo, useState, useCallback } from "react";
import { Hash, MessageCircle, Plus, Users } from "lucide-react";

import { useChannels } from "../api/useChannels";
import { useInboxConversations } from "../api/useInboxConversations";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useMemberLookup } from "../../workspaces/hooks/useMemberLookup";
import { usePrefetchMessages } from "../../../core/events/usePrefetchMessages";
import { cn } from "../../../shared/ui/cn";
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
    return <p className="px-2 py-4 text-sm text-red-300">Failed to load conversations.</p>;
  }

  if (channels.length === 0 && messages.length === 0) {
    return <p className="px-2 py-4 text-sm text-rim-text-muted">No conversations yet.</p>;
  }

  function renderItem(conv: { id: string; serverId: string; conversationType: string; title: string; memberIds: string[] }, globalIndex: number) {
    const Icon = typeIcon[conv.conversationType as ConversationTypeEnum] ?? Hash;
    const active = conv.id === selectedId;
    const focused = globalIndex === focusedIndex;

    // For DMs, show the other user's name instead of "Untitled"
    let displayTitle = conv.title;
    if (!displayTitle && conv.conversationType === "DIRECT" && conv.memberIds.length > 0) {
      const otherMemberId = conv.memberIds.find((id) => id !== currentUserId) ?? conv.memberIds[0];
      displayTitle = memberLookup.resolve(otherMemberId).displayName;
    }

    return (
      <li key={conv.id} role="option" aria-selected={active}>
        <button
          type="button"
          onClick={() => select(conv.id)}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition focus-visible:outline-none",
            active
              ? "bg-rim-accent/10 text-rim-accent"
              : "text-rim-text-muted hover:bg-white/5 hover:text-white",
            isKeyboardNavigating && focused && "ring-1 ring-rim-accent ring-offset-1 ring-offset-rim-panel",
          )}
        >
          <Icon className="h-4 w-4 shrink-0" />
          <span className="truncate">{displayTitle ?? "Untitled"}</span>
          <span className="ml-auto text-xs text-rim-text-faint">{conv.memberIds.length}</span>
        </button>
      </li>
    );
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
              className="rounded p-0.5 text-rim-text-faint transition hover:bg-white/5 hover:text-white"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
          <ul className="space-y-0.5">
            {channels.map((conv, i) => renderItem(conv, i))}
          </ul>
        </div>
      )}

      {messages.length > 0 && (
        <div>
          <h3 className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-rim-text-faint">
            Messages
          </h3>
          <ul className="space-y-0.5">
            {messages.map((conv, i) => renderItem(conv, channelCount + i))}
          </ul>
        </div>
      )}
    </div>
  );
}
