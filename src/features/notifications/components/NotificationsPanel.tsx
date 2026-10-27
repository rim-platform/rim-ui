import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AtSign,
  Bell,
  CheckCheck,
  Loader2,
  MessageCircle,
  MessagesSquare,
  SmilePlus,
  Tag,
  X,
  type LucideIcon,
} from "lucide-react";

import { cn } from "../../../shared/ui/cn";
import type { DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import {
  useContextMenu,
  type ContextMenuBindings,
} from "../../../shared/ui/contextMenu/useContextMenu";
import { toast } from "../../../shared/toast";
import { formatRelativeTime, formatTime } from "../../../shared/utils/formatTime";
import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { NotificationReason } from "../../../core/graphql/generated/schema-types";
import { useAuthStore } from "../../auth/state/useAuthStore";
import {
  useMuteConversationMutation,
  useUnmuteConversationMutation,
} from "../../conversations/api/useMuteConversation";
import { isMuteActive, useMutedConversations } from "../../conversations/api/useMutedConversations";
import { plainMessagePreview } from "../../messages/utils/snippetText";
import { DmRequestInbox } from "../../relay/components/DmRequestInbox";
import { principalUserId } from "../../workspaces/api/memberName";
import { useMemberLookup } from "../../workspaces/hooks/useMemberLookup";
import {
  useMarkNotificationsRead,
  useNotifications,
  type NotificationItem,
} from "../api/useNotifications";
import { authorDisplayName, notificationConversationLabel } from "../labels";
import { jumpToNotification } from "../runtime/jumpToNotification";
import { ENCRYPTED_MESSAGE_TEXT } from "../api/storedText";
import { useNotificationsPanelStore } from "../state/useNotificationsPanelStore";
import { MUTE_DURATIONS } from "../hooks/useConversationNotificationItems";

const REASONS: Record<NotificationReason, { label: string; icon: LucideIcon }> = {
  [NotificationReason.DIRECT]: { label: "Direct message", icon: MessageCircle },
  [NotificationReason.MENTION]: { label: "Mention", icon: AtSign },
  [NotificationReason.KEYWORD]: { label: "Keyword", icon: Tag },
  [NotificationReason.THREAD_REPLY]: { label: "Thread reply", icon: MessagesSquare },
  [NotificationReason.ALL]: { label: "New message", icon: Bell },
  [NotificationReason.REACTION]: { label: "Reaction", icon: SmilePlus },
};

const SNIPPET_LENGTH = 140;

/**
 * The preview of an entry's message: plain text with its mentions named, cut to
 * {@link SNIPPET_LENGTH} characters, or what stands in for a deleted, encrypted or text-less one.
 *
 * @param mentionName - the name of the member a mention token's id names, if known
 */
function snippet(item: NotificationItem, mentionName: (id: string) => string | undefined): string {
  const message = item.message;
  if (!message) return "";
  if (message.isDeleted) return "Message deleted";
  if (message.encryption && message.text === null) return ENCRYPTED_MESSAGE_TEXT;
  const text = plainMessagePreview(message.text ?? "", mentionName);
  if (!text) return "Attachment";
  return text.length > SNIPPET_LENGTH ? `${text.slice(0, SNIPPET_LENGTH)}…` : text;
}

interface NotificationsPanelProps {
  workspaceId: string;
  onClose: () => void;
}

/**
 * The notification inbox in the tool panel: newest first, unread entries dotted.
 * Clicking an entry opens its message and marks it read; entries whose conversation the viewer
 * can no longer read say so and can still be marked read. An entry's context menu marks it
 * read, mutes or unmutes its conversation, and opens it.
 */
export function NotificationsPanel({ workspaceId, onClose }: NotificationsPanelProps) {
  const qc = useQueryClient();
  const unreadOnly = useNotificationsPanelStore((s) => s.unreadOnly);
  const setUnreadOnly = useNotificationsPanelStore((s) => s.setUnreadOnly);
  const { data, isPending, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useNotifications(workspaceId, unreadOnly);
  const markRead = useMarkNotificationsRead();
  const memberLookup = useMemberLookup(workspaceId);
  const currentUserId = useAuthStore((s) => s.session?.userId);

  const items = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);

  function handleMarkAllRead() {
    markRead.mutate(
      { serverId: workspaceId, allBefore: new Date().toISOString() },
      {
        onError: (err) =>
          toast.error(graphqlErrorMessage(err, "Could not mark notifications read")),
      },
    );
  }

  function handleOpen(item: NotificationItem) {
    if (!item.readAt) {
      markRead.mutate({ serverId: workspaceId, ids: [item.id] });
    }
    if (!item.conversation) return;
    void jumpToNotification(qc, {
      serverId: workspaceId,
      conversationId: item.conversationId,
      messageId: item.messageId,
      threadId: item.message?.threadId ?? null,
    });
  }

  const resolveName = (userId: string) => memberLookup.resolve(userId).displayName;
  /** The name of the member a mention names, by user id or, in an encrypted message, principal id. */
  const mentionName = (id: string) =>
    resolveName(principalUserId(qc, workspaceId, id) ?? id) || undefined;

  const contextMenu = useContextMenu();
  const mute = useMuteConversationMutation();
  const unmute = useUnmuteConversationMutation();
  const { data: muted } = useMutedConversations(workspaceId);

  /**
   * An entry's menu: Mark as read while it is unread; then, while its conversation is
   * readable, Mute conversation (or Unmute) and Open.
   */
  function menuItems(item: NotificationItem): DropdownMenuItem[] {
    const result: DropdownMenuItem[] = [];
    if (!item.readAt) {
      result.push({
        id: "mark-read",
        label: "Mark as read",
        onSelect: () =>
          markRead.mutate(
            { serverId: workspaceId, ids: [item.id] },
            {
              onError: (err) =>
                toast.error(graphqlErrorMessage(err, "Could not mark the notification read")),
            },
          ),
      });
    }
    const conversation = item.conversation;
    if (!conversation) return result;
    const label = notificationConversationLabel(conversation, resolveName, currentUserId);
    const vars = { serverId: workspaceId, conversationId: item.conversationId };
    const mutedEntry = muted?.find((m) => m.conversationId === item.conversationId);
    if (mutedEntry && isMuteActive(mutedEntry)) {
      result.push({
        id: "unmute-conversation",
        label: "Unmute conversation",
        onSelect: () =>
          unmute.mutate(vars, {
            onError: (err) =>
              toast.error(graphqlErrorMessage(err, "Could not unmute the conversation")),
          }),
      });
    } else {
      result.push({
        id: "mute-conversation",
        label: "Mute conversation",
        submenu: MUTE_DURATIONS.map((duration) => ({
          id: duration.id,
          label: duration.label,
          onSelect: () => {
            const until = duration.until().toISOString();
            mute.mutate(
              { ...vars, mutedUntil: until },
              {
                onSuccess: () => toast.success(`Muted ${label} until ${formatTime(until)}`),
                onError: (err) =>
                  toast.error(graphqlErrorMessage(err, "Could not mute the conversation")),
              },
            );
          },
        })),
      });
    }
    result.push({ id: "open", label: "Open", onSelect: () => handleOpen(item) });
    return result;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-rim-line px-4 py-3">
        <h2 className="text-sm font-medium text-rim-text">Notifications</h2>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={handleMarkAllRead}
            disabled={markRead.isPending}
            title="Mark all read"
            aria-label="Mark all read"
            className="rounded-lg p-1 text-rim-text-muted transition hover:bg-white/5 hover:text-rim-text disabled:opacity-50"
          >
            <CheckCheck className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Close notifications"
            aria-label="Close notifications"
            className="rounded-lg p-1 text-rim-text-muted transition hover:bg-white/5 hover:text-rim-text"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-rim-line px-3 py-2 text-xs">
        <button
          type="button"
          aria-pressed={!unreadOnly}
          onClick={() => setUnreadOnly(false)}
          className={cn(
            "rounded px-2 py-0.5 transition",
            !unreadOnly
              ? "bg-rim-accent/15 text-rim-accent"
              : "text-rim-text-muted hover:text-rim-text",
          )}
        >
          All
        </button>
        <button
          type="button"
          aria-pressed={unreadOnly}
          onClick={() => setUnreadOnly(true)}
          className={cn(
            "rounded px-2 py-0.5 transition",
            unreadOnly
              ? "bg-rim-accent/15 text-rim-accent"
              : "text-rim-text-muted hover:text-rim-text",
          )}
        >
          Unread only
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        <DmRequestInbox />
        {isPending && <p className="px-2 py-4 text-sm text-rim-text-muted">Loading…</p>}
        {isError && (
          <p role="alert" className="px-2 py-4 text-sm text-rim-danger">
            {graphqlErrorMessage(error, "Failed to load notifications.")}
          </p>
        )}
        {!isPending && !isError && items.length === 0 && (
          <p className="px-2 py-4 text-sm text-rim-text-muted">
            {unreadOnly ? "No unread notifications." : "No notifications yet."}
          </p>
        )}
        {items.length > 0 && (
          <ul className="space-y-0.5" aria-label="Notifications">
            {items.map((item) => (
              <NotificationRow
                key={item.id}
                item={item}
                resolveName={resolveName}
                mentionName={mentionName}
                currentUserId={currentUserId}
                onOpen={() => handleOpen(item)}
                contextMenu={contextMenu.bind(() => menuItems(item), {
                  label: "Notification actions",
                })}
              />
            ))}
          </ul>
        )}
        {hasNextPage && (
          <button
            type="button"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg px-2 py-1.5 text-xs text-rim-text-muted transition hover:bg-white/5 hover:text-rim-text disabled:opacity-50"
          >
            {isFetchingNextPage && <Loader2 className="h-3 w-3 animate-spin" />}
            Load more
          </button>
        )}
      </div>
      {contextMenu.menu}
    </div>
  );
}

function NotificationRow({
  item,
  resolveName,
  mentionName,
  currentUserId,
  onOpen,
  contextMenu,
}: {
  item: NotificationItem;
  resolveName: (userId: string) => string;
  mentionName: (id: string) => string | undefined;
  currentUserId: string | undefined;
  onOpen: () => void;
  contextMenu: ContextMenuBindings;
}) {
  const reason = REASONS[item.reason];
  const Icon = reason.icon;
  const unread = !item.readAt;
  const available = item.conversation !== null;
  const conversation = item.conversation
    ? notificationConversationLabel(item.conversation, resolveName, currentUserId)
    : "No longer available";
  const author = item.message
    ? (authorDisplayName(item.message.author) ?? resolveName(item.message.authorId))
    : null;

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        {...contextMenu}
        data-notification-id={item.id}
        className={cn(
          "flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition hover:bg-white/5",
          !available && "opacity-70",
        )}
      >
        <Icon
          className={cn(
            "mt-0.5 h-4 w-4 shrink-0",
            unread ? "text-rim-accent" : "text-rim-text-faint",
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[11px] text-rim-text-faint">
            <span className="shrink-0 whitespace-nowrap">{reason.label}</span>
            <span aria-hidden>·</span>
            <span
              className={cn("min-w-0 truncate", available ? "text-rim-text-muted" : "italic")}
              title={conversation}
            >
              {conversation}
            </span>
            <span className="ml-auto shrink-0">{formatRelativeTime(item.createdAt)}</span>
          </span>
          {available && author && (
            <span
              className={cn(
                "mt-0.5 block truncate text-sm",
                unread ? "font-medium text-rim-text" : "text-rim-text-muted",
              )}
            >
              <span>{author}</span>
              <span className="text-rim-text-faint">: </span>
              <span className={unread ? "text-rim-text-muted" : "text-rim-text-faint"}>
                {snippet(item, mentionName)}
              </span>
            </span>
          )}
        </span>
        {unread && (
          <>
            <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-rim-accent" />
            <span className="sr-only">Unread</span>
          </>
        )}
      </button>
    </li>
  );
}
