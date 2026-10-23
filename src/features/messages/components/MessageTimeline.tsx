import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useDeleteMessage } from "../hooks/useDeleteMessage";
import { useMessageNavigation } from "../hooks/useMessageNavigation";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useMemberLookup } from "../../workspaces/hooks/useMemberLookup";
import { rememberHandles } from "../../workspaces/state/useKnownHandles";
import { viewHandle } from "../../../shared/utils/handles";
import { useUserContextMenu } from "../../workspaces/hooks/useUserContextMenu";
import { useLensStore } from "../../lenses/state/useLensStore";
import { LensBanner } from "../../lenses/components/LensBanner";
import { cn } from "../../../shared/ui/cn";
import { MessageItem } from "./MessageItem";
import { useMessageContextMenu } from "../hooks/useMessageContextMenu";
import { ForwardDialog } from "./ForwardDialog";
import { E2eeNoticeRow } from "../../e2ee/components/E2eeNoticeRow";
import { EncryptionNotices } from "../../e2ee/components/EncryptionNotices";
import { ConversationContinuity } from "../../relay/components/ConversationContinuity";
import {
  useDeviceNames,
  useE2eeConversation,
  usePrincipalNames,
} from "../../e2ee/hooks/useE2eeConversation";
import { invalidateTimeline } from "../../e2ee/runtime/groups";
import type { EncryptionContext, TimelineMessage } from "../../e2ee/utils/timeline";
import { useConversation } from "../../conversations/api/useConversation";
import { useDmRequestPending } from "../../conversations/api/useDmRequestPending";
import { directPeerId } from "../../conversations/utils";
import { Composer } from "./Composer";
import { DmRequestPendingNotice } from "./DmRequestPendingNotice";
import { TypingIndicator } from "./TypingIndicator";
import { HiddenPresenceContext } from "./message-item/hiddenPresence";
import { computeGroups } from "./timeline/computeGroups";
import { useNewMessagesDivider } from "./timeline/useNewMessagesDivider";
import { useMarkSeen } from "./timeline/useMarkSeen";
import { useTimelineHandlers, type TimelineMenuTarget } from "./timeline/useTimelineHandlers";
import { useTimelineItems } from "./timeline/useTimelineItems";
import { useHighlightedMessage } from "./timeline/useHighlightedMessage";
import { useTimelineScroll } from "./timeline/useTimelineScroll";
import { replyQuoteFor } from "./message-item/replyQuoteView";
import {
  NavigationHints,
  NewMessagesDivider,
  OlderMessagesLoader,
} from "./timeline/TimelineChrome";
import type { MessageMembers } from "./MessageItem";

/** The name a row shows for a message's author. */
function authorNameOf(msg: TimelineMessage, member: { displayName?: string | null }): string {
  return member.displayName || msg.author?.displayName || msg.author?.username || "Former member";
}

/**
 * The open conversation's timeline. In a direct conversation the other member has not accepted
 * yet, their presence stays hidden.
 */
export function MessageTimeline() {
  const peerId = usePendingPeer();
  return (
    <HiddenPresenceContext.Provider value={peerId}>
      <Timeline pendingPeerId={peerId} />
    </HiddenPresenceContext.Provider>
  );
}

/**
 * The other member of the open direct conversation while they have the viewer's DM as a
 * request they have not accepted; `null` otherwise.
 */
function usePendingPeer(): string | null {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const conversationId = useShellStore((s) => s.selectedConversationId);
  const currentUserId = useAuthStore((s) => s.session?.userId);
  const { data: conversation } = useConversation(workspaceId, conversationId);
  const pending = useDmRequestPending(workspaceId, conversationId);
  return pending && conversation ? (directPeerId(conversation, currentUserId) ?? null) : null;
}

function Timeline({ pendingPeerId }: { pendingPeerId: string | null }) {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const conversationId = useShellStore((s) => s.selectedConversationId);
  const openThread = useShellStore((s) => s.openThreadForMessage);
  const editingMessageId = useShellStore((s) => s.editingMessageId);
  const setEditingMessageId = useShellStore((s) => s.setEditingMessageId);
  const displayDensity = useShellStore((s) => s.displayDensity);
  const navigationMode = useShellStore((s) => s.navigationMode);
  const currentUserId = useAuthStore((s) => s.session?.userId);
  const clearLens = useLensStore((s) => s.setActiveLens);
  const memberLookup = useMemberLookup(workspaceId ?? undefined);

  const e2ee = useE2eeConversation(workspaceId, conversationId);
  const principalNames = usePrincipalNames(workspaceId);
  const resets = e2ee.group?.resets;
  const membership = e2ee.group?.membership;
  const encryption = useMemo<EncryptionContext | undefined>(
    () =>
      e2ee.encryptedAt
        ? {
            encryptedAt: e2ee.encryptedAt,
            resets: resets ?? [],
            membership: membership ?? [],
            userOfPrincipal: principalNames.userOf,
          }
        : undefined,
    [e2ee.encryptedAt, resets, membership, principalNames.userOf],
  );
  const deviceNameOf = useDeviceNames((resets ?? []).map((r) => r.principalId));

  const timeline = useTimelineItems(workspaceId, conversationId, encryption);
  const items: TimelineMessage[] = timeline.items;
  const formerNamesKey = JSON.stringify(
    [
      ...new Map(
        items
          .filter((message) => !memberLookup.map.has(message.authorId))
          .map((message) => [
            message.authorId,
            `${authorNameOf(message, memberLookup.resolve(message.authorId))}${memberLookup.resolve(message.authorId).isFormerMember ? " (former member)" : ""}`,
          ]),
      ).entries(),
    ].sort(([a], [b]) => a.localeCompare(b)),
  );
  // userId -> displayName map for mention rendering
  const memberDisplayMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const [userId, info] of memberLookup.map) map.set(userId, info.displayName);
    for (const [id, name] of JSON.parse(formerNamesKey) as [string, string][]) map.set(id, name);
    return map;
  }, [memberLookup.map, formerNamesKey]);
  const members = useMemo<MessageMembers>(
    () => ({ resolve: memberLookup.resolve, displayMap: memberDisplayMap }),
    [memberLookup.resolve, memberDisplayMap],
  );

  // What the viewer sent while their DM waits as a request.
  const sentCount = useMemo(
    () =>
      pendingPeerId ? items.filter((m) => !m.e2eeNotice && m.authorId === currentUserId).length : 0,
    [pendingPeerId, items, currentUserId],
  );
  const { isLensActive, activeLens } = timeline;
  useEffect(() => rememberHandles(items.map((m) => m.author)), [items]);
  const groups = useMemo(() => computeGroups(items), [items]);
  const itemsById = useMemo(() => new Map(items.map((m) => [m.id, m])), [items]);
  const mentionNameOf = useCallback(
    (userId: string) => memberDisplayMap.get(userId),
    [memberDisplayMap],
  );

  const isAtBottomRef = useRef(true);
  const {
    firstNewIndex,
    dividerFading,
    onScrollPosition: onDividerScrollPosition,
  } = useNewMessagesDivider({
    workspaceId,
    conversationId,
    items,
    isLensActive,
    isAtBottomRef,
  });
  const { onScrollPosition: onSeenScrollPosition } = useMarkSeen({
    workspaceId,
    conversationId,
    items,
    isLensActive,
    currentUserId,
    isAtBottomRef,
  });
  const onScrollPosition = useCallback(
    (atBottom: boolean) => {
      onDividerScrollPosition(atBottom);
      onSeenScrollPosition(atBottom);
    },
    [onDividerScrollPosition, onSeenScrollPosition],
  );

  const editingIndex = useMemo(
    () => (editingMessageId ? items.findIndex((m) => m.id === editingMessageId) : -1),
    [items, editingMessageId],
  );
  const { virtualizer, scrollContainerRef, topSentinelRef, handleScroll, scrollToIndex } =
    useTimelineScroll({
      listKey: conversationId,
      items,
      currentUserId,
      displayDensity,
      firstNewIndex,
      hasNextPage: timeline.hasNextPage,
      isFetchingNextPage: timeline.isFetchingNextPage,
      fetchNextPage: timeline.fetchNextPage,
      onScrollPosition,
      isAtBottomRef,
      pinnedIndex: editingIndex,
    });
  const highlightedMessageId = useHighlightedMessage({ items, scrollContainerRef, scrollToIndex });

  const [forwardMessage, setForwardMessage] = useState<{ id: string; text: string } | null>(null);
  const forward = useCallback((id: string, text: string) => setForwardMessage({ id, text }), []);
  const messageMenu = useMessageContextMenu({ workspaceId, conversationId, onForward: forward });
  const getMenuItems = (target: TimelineMenuTarget) =>
    messageMenu.getItems({ ...target, message: itemsById.get(target.messageId) });

  const {
    handlers: rowHandlers,
    editError,
    contextMenu,
    openActionsFor,
  } = useTimelineHandlers({
    items,
    workspaceId,
    conversationId,
    currentUserId,
    getMenuItems,
  });

  // A person's name, avatar or mention opens their menu, which wins over the row's.
  const userMenu = useUserContextMenu({ workspaceId });
  const { bind: bindUserContextMenu, openFrom: openUserMenu } = userMenu;
  const onMentionContextMenu = useCallback(
    (userId: string, mention: Element, event: React.MouseEvent | React.KeyboardEvent) => {
      openUserMenu(event, { userId }, mention);
    },
    [openUserMenu],
  );
  const handlers = useMemo(
    () => ({ ...rowHandlers, bindUserContextMenu, onMentionContextMenu }),
    [rowHandlers, bindUserContextMenu, onMentionContextMenu],
  );

  const deleteMessageFn = useDeleteMessage(workspaceId, conversationId);
  const handleDeleteMessage = useCallback(
    async (msg: { id: string }) => {
      await deleteMessageFn(msg.id);
    },
    [deleteMessageFn],
  );

  // Vim-style keyboard navigation for the message list
  const { selectedMessageIndex, deleteConfirmMessageId, handleMessageListKeyDown } =
    useMessageNavigation({
      items,
      conversationId,
      workspaceId,
      currentUserId,
      editingMessageId,
      setEditingMessageId,
      openThread,
      onDeleteMessage: handleDeleteMessage,
      onForwardMessage: setForwardMessage,
      onOpenActions: openActionsFor,
      firstNewIndex,
      scrollToIndex,
    });

  if (!conversationId) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-rim-text-muted">
        Select a conversation
      </div>
    );
  }

  if (timeline.isPending) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-rim-text-muted">
        {isLensActive ? "Applying lens..." : "Loading messages..."}
      </div>
    );
  }

  if (timeline.isError) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-rim-danger">
        {isLensActive ? "Failed to apply lens." : "Failed to load messages."}
      </div>
    );
  }

  const selectedMsg = selectedMessageIndex >= 0 ? items[selectedMessageIndex] : null;

  return (
    <div
      data-panel="mainSurface"
      tabIndex={-1}
      onFocus={() => useShellStore.getState().setFocusedSurface("mainSurface")}
      className="relative flex flex-1 flex-col overflow-hidden outline-none"
    >
      {isLensActive && activeLens && (
        <LensBanner
          lensName={activeLens.name}
          conditionCount={activeLens.filterSpec.conditions.length}
          onClear={() => clearLens(conversationId, null)}
        />
      )}
      {workspaceId && (
        <ConversationContinuity workspaceId={workspaceId} conversationId={conversationId} />
      )}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {timeline.isFetchingNextPage && <OlderMessagesLoader />}
        <div
          ref={scrollContainerRef}
          data-message-list
          tabIndex={0}
          role="listbox"
          aria-label="Messages"
          aria-activedescendant={selectedMsg ? `message-${selectedMsg.id}` : undefined}
          onScroll={handleScroll}
          onKeyDown={handleMessageListKeyDown}
          onFocus={() => useShellStore.getState().setNavigationMode(true)}
          className="relative flex-1 overflow-y-auto px-4 outline-none"
        >
          {/* Top sentinel for the infinite-scroll trigger; scrolls with the content. */}
          <div ref={topSentinelRef} aria-hidden className="absolute inset-x-0 top-0 h-1" />
          {items.length === 0 ? (
            <p className="py-11 text-center text-sm text-rim-text-muted">
              {isLensActive
                ? "No messages match this lens."
                : "No messages yet. Start the conversation below."}
            </p>
          ) : (
            <div
              data-virtual-list
              className="relative w-full"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map((row) => {
                const msg = items[row.index];
                if (msg.e2eeNotice && workspaceId) {
                  return (
                    <div
                      key={row.key}
                      data-index={row.index}
                      ref={virtualizer.measureElement}
                      className="absolute left-0 top-0 w-full"
                      style={{ transform: `translateY(${row.start}px)` }}
                    >
                      <E2eeNoticeRow
                        notice={msg.e2eeNotice}
                        nameOf={principalNames.nameOf}
                        deviceNameOf={deviceNameOf}
                        onRestored={() => invalidateTimeline(workspaceId, conversationId)}
                      />
                    </div>
                  );
                }
                const member = memberLookup.resolve(msg.authorId);
                const group = groups[row.index] ?? { isGrouped: false, isFirstInGroup: true };
                const parent = msg.parentMessageId ? itemsById.get(msg.parentMessageId) : undefined;
                const replyTo = msg.parentMessageId
                  ? replyQuoteFor(
                      msg.parentMessageId,
                      parent,
                      parent
                        ? `${authorNameOf(parent, memberLookup.resolve(parent.authorId))}${memberLookup.resolve(parent.authorId).isFormerMember ? " (former member)" : ""}`
                        : null,
                      mentionNameOf,
                    )
                  : null;
                return (
                  <div
                    key={row.key}
                    data-index={row.index}
                    ref={virtualizer.measureElement}
                    className={cn("absolute left-0 top-0 w-full", row.index > 0 && "pt-0.5")}
                    style={{ transform: `translateY(${row.start}px)` }}
                  >
                    {row.index === firstNewIndex && <NewMessagesDivider fading={dividerFading} />}
                    <MessageItem
                      view={{
                        message: msg,
                        replyTo,
                        author: {
                          name: authorNameOf(msg, member),
                          isFormerMember: member.isFormerMember,
                          avatarUrl: member.avatarUrl ?? msg.author?.avatarUrl,
                          username: member.username ?? msg.author?.username,
                          handle: viewHandle(
                            msg.author?.username ?? member.username,
                            msg.author?.handle ?? member.handle,
                            memberLookup.ownDomain,
                          ),
                          statusText: member.statusText,
                          role: member.role,
                          joinedAt: member.joinedAt,
                          bio: member.bio,
                          isCurrentUser: msg.author?.id === currentUserId,
                        },
                        isSelected: row.index === selectedMessageIndex,
                        isHighlighted: msg.id === highlightedMessageId,
                        isDeleteConfirming: msg.id === deleteConfirmMessageId,
                        isEditing: msg.id === editingMessageId,
                        editError: msg.id === editingMessageId && editError,
                        isGrouped: group.isGrouped,
                        isFirstInGroup: group.isFirstInGroup,
                        displayDensity,
                      }}
                      handlers={handlers}
                      members={members}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {navigationMode && (
        <NavigationHints
          hasSelection={selectedMessageIndex >= 0}
          isSelectedOwnMessage={selectedMsg?.author?.id === currentUserId}
          isDeleteConfirming={deleteConfirmMessageId !== null}
          hasNewMessages={firstNewIndex >= 0}
        />
      )}

      <TypingIndicator workspaceId={workspaceId} conversationId={conversationId} />
      {pendingPeerId && (
        <DmRequestPendingNotice
          name={memberLookup.resolve(pendingPeerId).displayName}
          sent={sentCount}
        />
      )}
      {workspaceId && <EncryptionNotices workspaceId={workspaceId} e2ee={e2ee} />}
      {workspaceId && (
        <Composer
          workspaceId={workspaceId}
          conversationId={conversationId}
          encryption={e2ee.encrypted ? e2ee : undefined}
        />
      )}
      {contextMenu}
      {messageMenu.dialog}
      {userMenu.element}
      {forwardMessage && workspaceId && (
        <ForwardDialog
          open={!!forwardMessage}
          onClose={() => {
            setForwardMessage(null);
            scrollContainerRef.current?.focus();
          }}
          messageId={forwardMessage.id}
          messageText={forwardMessage.text}
          workspaceId={workspaceId}
          sourceConversationId={conversationId}
        />
      )}
    </div>
  );
}
