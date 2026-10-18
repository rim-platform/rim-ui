import { useCallback, useEffect, useState } from "react";

import { useShellStore } from "../../../shell/state/useShellStore";
import {
  isContextMenuKey,
  useContextMenu,
  type ContextMenuBindings,
} from "../../../shared/ui/contextMenu/useContextMenu";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useDirectInbox } from "../../relay/api/useDirectInbox";
import { usePendingDmRequestsIn } from "../../relay/api/useDmRequests";
import { DmRequestsRow } from "../../relay/components/DmRequestsRow";
import { useMemberLookup } from "../../workspaces/hooks/useMemberLookup";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useConversationMenuItems } from "../hooks/useConversationMenuItems";
import { selectDirectConversation } from "../state/directSelection";
import { useMutedStore } from "../state/useMutedStore";
import { useUnreadStore } from "../state/useUnreadStore";
import type { ConversationSummary } from "../types";
import { conversationRowIn } from "../utils";
import { ConversationItem } from "./ConversationItem";
import { DraftDirectItem } from "./DraftDirectItem";

const ROW_MENU = { label: "Conversation actions" };

/**
 * The DMs and groups of every direct space this account uses, in one list: this relay's and
 * those of other relays. Opening one switches to its space.
 */
export function DirectConversationList() {
  const { items, isPending, isError } = useDirectInbox();
  const selectedId = useShellStore((s) => s.selectedConversationId);
  const draftDirect = useShellStore((s) => s.draftDirect);
  const draft = draftDirect && "spaceId" in draftDirect ? draftDirect : null;
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  // Requests from outside every workspace; a workspace's own requests stay in its sidebar.
  const requestCount = usePendingDmRequestsIn(null).length;
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const contextMenu = useContextMenu();
  const { bind: bindContextMenu, openUnder } = contextMenu;
  const { getItems: conversationMenuItems, dialogs: conversationDialogs } =
    useConversationMenuItems(workspaceId);
  const bindRowMenu = useCallback(
    (conv: ConversationSummary, label: string) =>
      bindContextMenu(() => conversationMenuItems(conv, { label }), ROW_MENU),
    [bindContextMenu, conversationMenuItems],
  );

  const open = useCallback(
    (id: string) => {
      const conversation = items.find((c) => c.id === id);
      if (conversation) selectDirectConversation(conversation.serverId, id);
      useShellStore.getState().setNavigationMode(false);
    },
    [items],
  );

  // Open the first conversation of the space shown when nothing is open; a draft DM counts as
  // open. A plugin panel the user has open stays over it.
  const draftOpen = draftDirect !== null;
  useEffect(() => {
    if (selectedId || draftOpen) return;
    const first = items.find((c) => c.serverId === workspaceId);
    if (first) {
      useShellStore.getState().setSelectedConversationId(first.id, { keepPluginPanel: true });
    }
  }, [selectedId, draftOpen, items, workspaceId]);

  if (isPending) {
    return <p className="px-2 py-4 text-sm text-rim-text-muted">Loading conversations...</p>;
  }
  if (isError) {
    return <p className="px-2 py-4 text-sm text-rim-danger">Failed to load conversations.</p>;
  }

  return (
    <>
      <div
        className="space-y-1"
        role="listbox"
        tabIndex={0}
        aria-label="Direct messages"
        onKeyDown={(e) => {
          if (isContextMenuKey(e)) {
            // A focused row opened its own menu; otherwise the highlighted row's opens.
            const conv = items[focusedIndex];
            const row = conv ? conversationRowIn(e.currentTarget, conv.id) : null;
            if (!e.defaultPrevented && conv && row) {
              if (openUnder(row, () => conversationMenuItems(conv), ROW_MENU)) e.preventDefault();
            }
          } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const by = e.key === "ArrowDown" ? 1 : -1;
            setFocusedIndex((i) => Math.min(Math.max(i + by, 0), items.length - 1));
          } else if ((e.key === "Home" || e.key === "End") && items.length > 0) {
            e.preventDefault();
            setFocusedIndex(e.key === "Home" ? 0 : items.length - 1);
          } else if (e.key === "Enter" && items[focusedIndex]) {
            e.preventDefault();
            open(items[focusedIndex].id);
          }
        }}
        onBlur={() => setFocusedIndex(-1)}
      >
        <h3 className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-rim-text-faint">
          Direct messages
        </h3>
        <DmRequestsRow workspaceId={null} count={requestCount} />
        {items.length === 0 && !draft ? (
          <p className="px-2 py-2 text-sm text-rim-text-muted">
            No conversations yet. Start one with a contact.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {draft && <DraftDirectItem draft={draft} />}
            {items.map((conversation, i) => (
              <DirectConversationRow
                key={`${conversation.serverId}:${conversation.id}`}
                conversation={conversation}
                index={i}
                focusedIndex={focusedIndex}
                selectedId={selectedId}
                open={open}
                bindMenu={bindRowMenu}
              />
            ))}
          </ul>
        )}
      </div>
      {contextMenu.menu}
      {conversationDialogs}
    </>
  );
}

/** A row named from the members of the conversation's own space. */
function DirectConversationRow({
  conversation,
  index,
  focusedIndex,
  selectedId,
  open,
  bindMenu,
}: {
  conversation: ConversationSummary;
  index: number;
  focusedIndex: number;
  selectedId: string | null;
  open: (id: string) => void;
  bindMenu: (conv: ConversationSummary, label: string) => ContextMenuBindings;
}) {
  const currentUserId = useAuthStore((s) => s.session?.userId);
  const memberLookup = useMemberLookup(conversation.serverId);
  const unread = useUnreadStore((s) => s.counts[conversation.id] ?? 0);
  const muted = useMutedStore((s) => s.mutedIds.has(conversation.id));
  return (
    <ConversationItem
      conv={conversation}
      globalIndex={index}
      selectedId={selectedId}
      focusedIndex={focusedIndex}
      isKeyboardNavigating={focusedIndex >= 0}
      currentUserId={currentUserId}
      memberLookup={memberLookup}
      select={open}
      unreadCount={unread}
      isMuted={muted}
      bindMenu={bindMenu}
    />
  );
}
