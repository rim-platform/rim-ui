import { memo } from "react";
import { BellOff } from "lucide-react";

import {
  ConversationTypeEnum,
  NotificationLevel,
} from "../../../core/graphql/generated/schema-types";
import { useHoverContextStore } from "../../../shell/state/useHoverContextStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { Avatar } from "../../../shared/ui/Avatar";
import { cn } from "../../../shared/ui/cn";
import { HoverTooltip } from "../../../shared/ui/HoverTooltip";
import { useKeybindLabel } from "../../commands/hooks/useKeybindLabel";
import { LockMark } from "../../e2ee/components/LockMark";
import { useDraftStore } from "../../messages/state/useDraftStore";
import { usePresenceStore } from "../../presence/state/usePresenceStore";
import type { useMemberLookup } from "../../workspaces/hooks/useMemberLookup";
import type { ConversationSummary } from "../types";
import { directPeerId, isInvited } from "../utils";
import { ChannelIcon } from "./ChannelIcon";

/** One row of the side rail's conversation list: a channel, or a DM shown as its other member. */
export const ConversationItem = memo(function ConversationItem({
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
  if (conv.conversationType === ConversationTypeEnum.DIRECT) {
    otherMemberId = directPeerId(conv, currentUserId);
  }
  if (otherMemberId) {
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
  // The viewer holds an invitation here and joins from the conversation.
  const invited = isInvited(conv, currentUserId);

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
      {invited ? (
        <span className="ml-auto shrink-0 rounded border border-rim-accent/40 px-1 text-[10px] uppercase tracking-wider text-rim-accent">
          Invited
        </span>
      ) : unreadCount > 0 && !active ? (
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
