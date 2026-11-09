import { useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "../../../core/query/keys";
import { cn } from "../../../shared/ui/cn";
import { Button } from "../../../shared/ui/Button";
import { workspaceInitials } from "../../../shared/utils/initials";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { runCommandFromClick } from "../../commands/runtime/runFromClick";
import { useConversation } from "../../conversations/api/useConversation";
import type { DeferredTarget } from "../../conversations/api/deferredMark";
import { useUnreadStore } from "../../conversations/state/useUnreadStore";
import { useE2eeStore } from "../../e2ee/state/useE2eeStore";
import { MessageItem, type MessageItemHandlers } from "../../messages/components/MessageItem";
import { replyQuoteFor } from "../../messages/components/message-item/replyQuoteView";
import { computeGroups } from "../../messages/components/timeline/computeGroups";
import { messageAuthorView, useMessageMembers } from "../../messages/hooks/useMessageMembers";
import { notificationConversationLabel } from "../../notifications/labels";
import { jumpToNotification } from "../../notifications/runtime/jumpToNotification";
import { useMemberLookup } from "../../workspaces/hooks/useMemberLookup";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { GROUP_PAGE_SIZE, useUnreadGroupMessages } from "../api/useUnreadGroupMessages";
import type { UnreadGroup } from "../api/useUnreadGroups";

const NOOP = () => undefined;

/** The handlers of a row that only shows its message: no reactions, replies or threads. */
const READ_ONLY_HANDLERS: MessageItemHandlers = {
  onOpenThread: NOOP,
  onToggleReaction: NOOP,
  canAddReaction: false,
  canStartThread: false,
};

/** The DOM id of the row a group shows in place of messages. */
function groupRowId(conversationId: string): string {
  return `unreads-group-${conversationId}`;
}

/** What the page and its commands can ask of a group on screen. */
export interface GroupActions {
  /** What marking the group read now would cover, or null while it has shown nothing. */
  markTarget: () => DeferredTarget | null;
  /** Marks the group read up to the newest message it has shown. */
  mark: () => void;
  /** Opens the conversation at this message, or at the group's first unread without one. */
  open: (messageId?: string) => void;
}

/** A warm line for something that did not answer, with Retry. */
export function FailureCard({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 rounded-xl border border-rim-warm/30 bg-rim-warm/10 px-3.5 py-3"
    >
      <span className="min-w-0 flex-1 text-sm text-rim-warm">{text}</span>
      <Button type="button" size="sm" variant="secondary" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

/** A key the page answers to, shown on the selected group's buttons. */
function KeyHint({ children }: { children: string }) {
  return (
    <kbd
      aria-hidden
      className="ml-1.5 rounded border border-rim-line px-1 font-mono text-[10px] text-rim-text-muted"
    >
      {children}
    </kbd>
  );
}

interface UnreadGroupSectionProps {
  group: UnreadGroup;
  selectedRowId: string | null;
  onSelectRow: (rowId: string) => void;
  /** Whether the group may read its messages yet. */
  started: boolean;
  /** The group came into view. */
  onVisible: (conversationId: string) => void;
  /** The group's first read has answered. */
  onSettled: (conversationId: string) => void;
  /** The time of the group's newest message, once it is known. */
  onNewest: (conversationId: string, sentAt: string) => void;
  /** Keeps what the page can ask of this group, or takes it back with null. */
  register: (conversationId: string, actions: GroupActions | null) => void;
  /** Marks the group read, as the page does for all its marks. */
  onMark: (target: DeferredTarget) => void;
}

/**
 * One conversation on the Unreads page: its first unread messages in read-only rows, loading once
 * it has been in view, with Mark as read and Open. Only its count shows on a host without read
 * markers, or when this device holds no text of an encrypted conversation. Looking at it marks
 * nothing.
 */
export function UnreadGroupSection({
  group,
  selectedRowId,
  onSelectRow,
  started,
  onVisible,
  onSettled,
  onNewest,
  register,
  onMark,
}: UnreadGroupSectionProps) {
  const { conversationId, space, count, marker } = group;
  const qc = useQueryClient();
  const rootRef = useRef<HTMLElement>(null);
  const currentUserId = useAuthStore((s) => s.session?.userId);
  const memberLookup = useMemberLookup(space.id);
  const pinned = useE2eeStore((s) => s.groups[conversationId]?.pinned ?? false);
  const leftByMark = useUnreadStore((s) => s.conversationMarks[conversationId]);
  const displayDensity = useShellStore((s) => s.displayDensity);

  // The lists reach only their first page: one they don't reach is read on its own, in view.
  const lookup = useConversation(
    started && !group.conversation && !group.namesPending ? space.id : null,
    started && !group.conversation && !group.namesPending ? conversationId : null,
  );
  const conversation = group.conversation ?? lookup.data ?? undefined;
  const encrypted = Boolean(conversation?.encryptedAt) || pinned;
  // A read that is not running has nothing to say: an invitation, say, is not read at all.
  const lookupDone = !lookup.isPending || lookup.fetchStatus === "idle";
  const kindKnown = Boolean(conversation) || (!group.namesPending && lookupDone);

  const name = conversation
    ? notificationConversationLabel(
        conversation,
        (id) => memberLookup.resolve(id).displayName,
        currentUserId,
      )
    : !started || !kindKnown
      ? null
      : "A conversation";

  const query = useUnreadGroupMessages({
    workspaceId: space.id,
    conversationId,
    marker,
    encrypted,
    enabled: started && kindKnown && group.markId === null,
  });
  const pages = query.data?.pages;
  const items = useMemo(() => pages?.flatMap((page) => page.items) ?? [], [pages]);
  const unreadable = marker === null || Boolean(pages?.some((page) => page.unreadable));
  const shownItems = useMemo(() => (unreadable ? [] : items), [unreadable, items]);
  const members = useMessageMembers(memberLookup, shownItems);
  const rowGroups = useMemo(() => computeGroups(shownItems), [shownItems]);
  const shownFromOthers = shownItems.filter((m) => m.authorId !== currentUserId).length;
  const left = Math.max(0, count - shownFromOthers);
  const newest = shownItems[shownItems.length - 1];

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onVisible(conversationId);
      },
      { rootMargin: "200px" },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, [conversationId, onVisible]);

  const firstReadDone = marker === null || query.isFetched;
  useEffect(() => {
    if (started && firstReadDone) onSettled(conversationId);
  }, [started, firstReadDone, conversationId, onSettled]);

  const newestAt = newest?.sentAt;
  useEffect(() => {
    if (newestAt) onNewest(conversationId, newestAt);
  }, [newestAt, conversationId, onNewest]);

  // A workspace that sends no events here shows a new message through its count.
  const previousCountRef = useRef(count);
  useEffect(() => {
    const previous = previousCountRef.current;
    previousCountRef.current = count;
    if (count > previous) {
      void qc.invalidateQueries({
        queryKey: queryKeys.unreadGroupMessagesOf(space.id, conversationId),
      });
    }
  }, [count, qc, space.id, conversationId]);

  const firstId = shownItems[0]?.id;
  const actions = useMemo<GroupActions>(() => {
    const markTarget = (): DeferredTarget | null =>
      newestAt
        ? {
            kind: "conversation",
            workspaceId: space.id,
            conversationId,
            readAt: newestAt,
            remaining: left,
          }
        : null;
    return {
      markTarget,
      mark: () => {
        const target = markTarget();
        if (target) onMark(target);
      },
      open: (messageId) => {
        const target = messageId ?? firstId;
        if (target) {
          void jumpToNotification(qc, {
            serverId: space.id,
            conversationId,
            messageId: target,
            threadId: null,
          });
          return;
        }
        const workspaces = useWorkspaceStore.getState();
        if (workspaces.workspaceId !== space.id) workspaces.setWorkspaceId(space.id);
        const shell = useShellStore.getState();
        shell.setMainSurface({ kind: "conversation" });
        shell.setSelectedConversationId(conversationId);
      },
    };
  }, [newestAt, left, firstId, space.id, conversationId, onMark, qc]);

  useEffect(() => {
    register(conversationId, actions);
    return () => register(conversationId, null);
  }, [conversationId, actions, register]);

  if (group.markId !== null) {
    if (!group.markedAlone) return null;
    const markId = group.markId;
    return (
      <div
        role="status"
        data-unread-mark={conversationId}
        className="flex flex-wrap items-center gap-3 rounded-xl border border-rim-success/30 bg-rim-success/5 px-3.5 py-3"
      >
        <span className="min-w-0 flex-1 text-sm text-rim-text">
          {name ?? "A conversation"} marked as read
          {leftByMark ? `, ${leftByMark} newer stay unread` : ""}
        </span>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => void runCommandFromClick("workspace.unreads_undo", { mark_id: markId })}
        >
          Undo
          <KeyHint>U</KeyHint>
        </Button>
      </div>
    );
  }

  if (started && query.isError) {
    return (
      <section ref={rootRef} data-unread-group={conversationId}>
        <div
          role="option"
          id={groupRowId(conversationId)}
          aria-selected={selectedRowId === groupRowId(conversationId)}
        >
          <FailureCard
            text={`Couldn't load ${name ?? "this conversation"}.`}
            onRetry={() => void query.refetch()}
          />
        </div>
      </section>
    );
  }

  const countOnly = unreadable;
  const selectedHere =
    selectedRowId !== null &&
    (selectedRowId === groupRowId(conversationId) ||
      shownItems.some((m) => `message-${m.id}` === selectedRowId));
  const nextPageSize = Math.min(GROUP_PAGE_SIZE, left);
  const countLine = `${space.label} · ${count} unread`;

  return (
    <section
      ref={rootRef}
      role="group"
      aria-label={name ?? "A conversation"}
      data-unread-group={conversationId}
      onClick={(event) => {
        const target = event.target as Element;
        if (target.closest("button, a")) return;
        const row = target.closest('[role="option"]');
        if (row?.id) onSelectRow(row.id);
      }}
      className={cn(
        "overflow-hidden rounded-xl border bg-rim-panel",
        countOnly ? "border-dashed border-rim-line" : "border-rim-line",
      )}
    >
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2.5",
          !countOnly && "border-b border-rim-line",
        )}
      >
        <span
          aria-hidden
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-rim-panel-soft text-[10px] font-semibold text-rim-text-muted"
        >
          {workspaceInitials(space.label)}
        </span>
        <div className="flex min-w-0 flex-[1_1_12rem] flex-wrap items-baseline gap-x-2">
          {name === null ? (
            <span
              aria-hidden
              data-testid="unread-group-name-skeleton"
              className="inline-block h-3.5 w-28 animate-pulse rounded bg-rim-panel-soft"
            />
          ) : (
            <h2 className="min-w-0 break-words text-sm font-semibold text-rim-text">{name}</h2>
          )}
          <span className="text-xs text-rim-text-muted">
            {encrypted && countOnly ? `Encrypted · ${count} unread` : countLine}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {countOnly ? (
            <Button type="button" size="sm" variant="secondary" onClick={() => actions.open()}>
              Open to read
              {selectedHere && <KeyHint>Enter</KeyHint>}
            </Button>
          ) : (
            <>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={!newest}
                onClick={actions.mark}
              >
                Mark as read
                {selectedHere && <KeyHint>E</KeyHint>}
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => actions.open()}>
                Open
                {selectedHere && <KeyHint>Enter</KeyHint>}
              </Button>
            </>
          )}
        </div>
      </div>
      {(countOnly || shownItems.length === 0) && (
        <div
          role="option"
          id={groupRowId(conversationId)}
          aria-selected={selectedRowId === groupRowId(conversationId)}
          aria-label={`${name ?? "A conversation"}, ${count} unread`}
          className={cn(
            selectedRowId === groupRowId(conversationId) &&
              "border-l-2 border-rim-accent bg-rim-accent/5",
            !countOnly && "px-3.5 py-3 text-xs text-rim-text-muted",
          )}
        >
          {!countOnly && "Loading messages…"}
        </div>
      )}
      {shownItems.length > 0 && (
        <div className="px-1 py-1">
          {shownItems.map((message, index) => {
            const parent = message.parentMessageId
              ? shownItems.find((m) => m.id === message.parentMessageId)
              : undefined;
            const rowGroup = rowGroups[index] ?? { isGrouped: false, isFirstInGroup: true };
            return (
              <MessageItem
                key={message.id}
                view={{
                  message: { ...message, reactions: [] },
                  replyTo: message.parentMessageId
                    ? replyQuoteFor(
                        message.parentMessageId,
                        parent,
                        parent ? memberLookup.resolve(parent.authorId).displayName : null,
                        (id) => members.displayMap?.get(id),
                      )
                    : null,
                  author: messageAuthorView(message, memberLookup.resolve(message.authorId), {
                    ownDomain: memberLookup.ownDomain,
                    inDirectSpace: space.direct,
                    currentUserId,
                  }),
                  isSelected: selectedRowId === `message-${message.id}`,
                  isGrouped: rowGroup.isGrouped,
                  isFirstInGroup: rowGroup.isFirstInGroup,
                  displayDensity,
                  inThreadPane: true,
                }}
                handlers={READ_ONLY_HANDLERS}
                members={members}
              />
            );
          })}
        </div>
      )}
      {query.hasNextPage && !countOnly && (
        <div className="px-3.5 py-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {nextPageSize > 0 ? `Show ${nextPageSize} more` : "Show more"}
          </Button>
        </div>
      )}
    </section>
  );
}
