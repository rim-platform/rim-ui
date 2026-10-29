import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { activeBan, banLabel, useBanExpiry } from "../hooks/useBanExpiry";
import { useDeleteMessage } from "../hooks/useDeleteMessage";
import { authorNameOf, useMessageMembers } from "../hooks/useMessageMembers";
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
import { LockMark } from "../../e2ee/components/LockMark";
import { ConversationContinuity } from "../../relay/components/ConversationContinuity";
import { DmRequestBar } from "../../relay/components/DmRequestBar";
import { incomingRequestOf } from "../../relay/components/useDmRequestActions";
import { useIsDirectSpace } from "../../relay/state/useRelayStore";
import { usePendingDmRequests } from "../../relay/api/useDmRequests";
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
import { useReplyTargetStore } from "../state/useReplyTargetStore";
import { useMessageFoldStore } from "../state/useMessageFoldStore";
import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";
import { usePostingRights } from "../../conversations/api/useChannelPosting";
import { useCanModerate } from "../../workspaces/api/useMyServerRole";
import { useClearMessageFlag } from "../../workspaces/api/useModeration";
import {
  NavigationHints,
  NewMessagesDivider,
  OlderMessagesLoader,
} from "./timeline/TimelineChrome";

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
  const inDirectSpace = useIsDirectSpace(workspaceId);
  const { data: pendingRequests } = usePendingDmRequests();
  const incomingRequest = incomingRequestOf(pendingRequests, conversationId);
  const { data: conversation } = useConversation(workspaceId, conversationId);

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
  useBanExpiry(
    workspaceId,
    items.map((message) => message.author),
  );
  const members = useMessageMembers(memberLookup, items);

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
    (userId: string) => members.displayMap?.get(userId),
    [members.displayMap],
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
  // The message a held pointer press on the list landed on (`""` for none), or null.
  const pointerEntryRef = useRef<string | null>(null);
  // A press ends wherever the pointer is released, inside the list or not.
  useEffect(() => {
    const release = () => {
      pointerEntryRef.current = null;
    };
    window.addEventListener("mouseup", release, true);
    return () => window.removeEventListener("mouseup", release, true);
  }, []);
  const {
    virtualizer,
    scrollContainerRef,
    topSentinelRef,
    handleScroll,
    scrollToIndex,
    onFoldToggle,
  } = useTimelineScroll({
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
    hintBarShown: navigationMode,
    pointerPressRef: pointerEntryRef,
  });
  const highlightedMessageId = useHighlightedMessage({ items, scrollContainerRef, scrollToIndex });

  const [forwardMessage, setForwardMessage] = useState<{ id: string; text: string } | null>(null);
  const forward = useCallback((id: string, text: string) => setForwardMessage({ id, text }), []);

  // Reply is offered where the composer, not a bar in its place, is shown.
  const rights = usePostingRights(workspaceId, conversationId);
  const canReply =
    rights.message &&
    conversation !== undefined &&
    !conversation.isArchived &&
    (conversation.conversationType !== ConversationTypeEnum.CHANNEL || conversation.isMember) &&
    !incomingRequest;
  // Read through a ref so a new message does not rebuild the rows' shared handlers.
  const replySourceRef = useRef({ itemsById, mentionNameOf });
  useLayoutEffect(() => {
    replySourceRef.current = { itemsById, mentionNameOf };
  }, [itemsById, mentionNameOf]);
  const startReply = useCallback(
    (messageId: string) => {
      const source = replySourceRef.current;
      const msg = source.itemsById.get(messageId);
      if (!conversationId || !msg || msg.isDeleted || msg.e2eeNotice) return;
      useReplyTargetStore.getState().start(conversationId, {
        messageId,
        authorId: msg.authorId,
        excerpt: replyQuoteFor(messageId, msg, null, source.mentionNameOf).excerpt,
      });
      useShellStore.getState().setNavigationMode(false);
      document.querySelector<HTMLTextAreaElement>("[data-composer-input]")?.focus();
    },
    [conversationId],
  );
  const onReply = canReply ? startReply : undefined;

  const messageMenu = useMessageContextMenu({
    workspaceId,
    conversationId,
    onForward: forward,
    onReply,
  });
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
  const canModerate = useCanModerate(workspaceId ?? undefined);
  const { mutate: clearMessageFlag } = useClearMessageFlag();
  const onClearFlag = useCallback(
    (messageId: string) => {
      if (!workspaceId || !conversationId) return;
      clearMessageFlag({ serverId: workspaceId, conversationId, messageId });
    },
    [workspaceId, conversationId, clearMessageFlag],
  );
  const handlers = useMemo(
    () => ({
      ...rowHandlers,
      bindUserContextMenu,
      onMentionContextMenu,
      canAddReaction: rights.reaction,
      canStartThread: rights.thread,
      onReply,
      onFoldToggle,
      canModerate,
      onClearFlag,
    }),
    [
      rowHandlers,
      bindUserContextMenu,
      onMentionContextMenu,
      rights.reaction,
      rights.thread,
      onReply,
      onFoldToggle,
      canModerate,
      onClearFlag,
    ],
  );

  const deleteMessageFn = useDeleteMessage(workspaceId, conversationId);
  const handleDeleteMessage = useCallback(
    async (msg: { id: string }) => {
      await deleteMessageFn(msg.id);
    },
    [deleteMessageFn],
  );

  // Vim-style keyboard navigation for the message list
  const {
    selectedMessageIndex,
    deleteConfirmMessageId,
    handleMessageListKeyDown,
    selectPressedMessage,
  } = useMessageNavigation({
    items,
    conversationId,
    workspaceId,
    currentUserId,
    editingMessageId,
    setEditingMessageId,
    openThread,
    onDeleteMessage: handleDeleteMessage,
    onForwardMessage: setForwardMessage,
    onReply,
    canStartThread: rights.thread,
    canPin: rights.pin,
    onOpenActions: openActionsFor,
    onFoldToggle,
    firstNewIndex,
    scrollToIndex,
    pointerEntryRef,
  });
  const selectedId = selectedMessageIndex >= 0 ? items[selectedMessageIndex]?.id : undefined;
  const selectedFoldable = useMessageFoldStore((s) =>
    selectedId ? s.foldable.has(selectedId) : false,
  );
  const selectedExpanded = useMessageFoldStore((s) =>
    selectedId ? s.expanded.has(selectedId) : false,
  );

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
  // A message being edited shows its edit form, which does not fold.
  const foldState =
    selectedFoldable && selectedMessageIndex !== editingIndex
      ? selectedExpanded
        ? "expanded"
        : "folded"
      : null;

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
          onMouseDown={(e) => {
            pointerEntryRef.current =
              (e.target as Element).closest("[data-message-id]")?.getAttribute("data-message-id") ??
              "";
            if (pointerEntryRef.current !== "") selectPressedMessage(pointerEntryRef.current);
          }}
          onFocus={() => useShellStore.getState().setNavigationMode(true)}
          onBlur={() => {
            pointerEntryRef.current = null;
          }}
          className="relative flex-1 overflow-y-auto px-4 outline-none"
        >
          {/* Top sentinel for the infinite-scroll trigger; scrolls with the content. */}
          <div ref={topSentinelRef} aria-hidden className="absolute inset-x-0 top-0 h-1" />
          {items.length === 0 ? (
            <div className="py-11">
              <p className="text-center text-sm text-rim-text-muted">
                {isLensActive
                  ? "No messages match this lens."
                  : "No messages yet. Start the conversation below."}
              </p>
              {!isLensActive && e2ee.encrypted && (
                <p
                  data-testid="timeline-empty-encrypted"
                  className="flex items-center justify-center gap-1 text-xs text-rim-text-faint"
                >
                  <LockMark />
                  This conversation is end-to-end encrypted.
                </p>
              )}
            </div>
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
                        ? `${authorNameOf(parent, memberLookup.resolve(parent.authorId))}${activeBan(parent.author) ? ` (${banLabel(parent.author)})` : memberLookup.resolve(parent.authorId).isFormerMember ? " (former member)" : ""}`
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
                          ban: {
                            banned: activeBan(msg.author),
                            bannedUntil: msg.author?.bannedUntil,
                            banReason: msg.author?.banReason,
                          },
                          avatarUrl: member.avatarUrl ?? msg.author?.avatarUrl,
                          username: member.username ?? msg.author?.username,
                          handle: viewHandle(
                            msg.author?.username ?? member.username,
                            msg.author?.handle ?? member.handle,
                            memberLookup.ownDomain,
                          ),
                          statusText: member.statusText,
                          role: inDirectSpace ? undefined : member.role,
                          inDirectSpace,
                          joinedAt: member.joinedAt,
                          bio: member.bio,
                          isCurrentUser:
                            currentUserId !== undefined && msg.authorId === currentUserId,
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
        {navigationMode && (
          <NavigationHints
            hasSelection={selectedMessageIndex >= 0}
            isSelectedOwnMessage={
              currentUserId !== undefined && selectedMsg?.authorId === currentUserId
            }
            isDeleteConfirming={deleteConfirmMessageId !== null}
            hasNewMessages={firstNewIndex >= 0}
            canReply={canReply}
            canThread={rights.thread || Boolean(selectedMsg?.rootThreadId)}
            canPin={rights.pin}
            foldState={foldState}
          />
        )}
      </div>

      <TypingIndicator workspaceId={workspaceId} conversationId={conversationId} />
      {pendingPeerId && (
        <DmRequestPendingNotice
          name={memberLookup.resolve(pendingPeerId).displayName}
          sent={sentCount}
        />
      )}
      {workspaceId && <EncryptionNotices workspaceId={workspaceId} e2ee={e2ee} />}
      {/* A request the viewer has not decided takes no reply: it is decided first. */}
      {incomingRequest ? (
        <DmRequestBar request={incomingRequest} />
      ) : (
        workspaceId && (
          <Composer
            workspaceId={workspaceId}
            conversationId={conversationId}
            encryption={e2ee.encrypted ? e2ee : undefined}
          />
        )
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
