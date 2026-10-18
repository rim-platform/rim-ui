import { Bell, Check, ChevronLeft, Timer } from "lucide-react";

import type { DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import { toast } from "../../../shared/toast";
import { formatTime } from "../../../shared/utils/formatTime";
import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { NotificationLevel } from "../../../core/graphql/generated/schema-types";
import {
  useMuteConversationMutation,
  useUnmuteConversationMutation,
} from "../../conversations/api/useMuteConversation";
import { isMuteActive, useMutedConversations } from "../../conversations/api/useMutedConversations";
import type { ConversationSummary } from "../../conversations/types";
import { conversationLabel } from "../../conversations/utils";
import { useSetConversationNotificationLevel } from "../api/useConversationNotificationLevel";
import { useNotificationSettings } from "../api/useNotificationSettings";
import { inOneHour, tomorrowMorning } from "../rules";

export const LEVEL_LABELS: Record<NotificationLevel, string> = {
  [NotificationLevel.ALL]: "All messages",
  [NotificationLevel.MENTIONS]: "Mentions",
  [NotificationLevel.NONE]: "None",
};

const LEVEL_ORDER = [NotificationLevel.ALL, NotificationLevel.MENTIONS, NotificationLevel.NONE];

export const MUTE_DURATIONS: { id: string; label: string; until: () => Date }[] = [
  { id: "mute-1h", label: "Mute for 1 hour", until: () => inOneHour() },
  {
    id: "mute-8h",
    label: "Mute for 8 hours",
    until: () => new Date(Date.now() + 8 * 60 * 60 * 1000),
  },
  { id: "mute-tomorrow", label: "Mute until tomorrow", until: () => tomorrowMorning() },
];

function markedIcon(selected: boolean) {
  return selected ? (
    <>
      <Check className="h-4 w-4 shrink-0 text-rim-accent" />
      <span className="sr-only">Current:</span>
    </>
  ) : (
    <span className="h-4 w-4 shrink-0" />
  );
}

interface UseConversationNotificationMenuOptions {
  workspaceId: string;
  conversation: ConversationSummary;
  /** Whether the menu is open (the workspace default is only fetched then). */
  open: boolean;
  onBack: () => void;
  onDone: () => void;
}

/**
 * The conversation menu's Notifications submenu: the viewer's level for the conversation
 * (All / Mentions / None / Use workspace default, the current choice checked) and the
 * timed-mute quick actions. `summary` names what applies now, for the parent item.
 */
export function useConversationNotificationMenu({
  workspaceId,
  conversation,
  open,
  onBack,
  onDone,
}: UseConversationNotificationMenuOptions): { summary: string; items: DropdownMenuItem[] } {
  const setLevel = useSetConversationNotificationLevel();
  const mute = useMuteConversationMutation();
  const unmute = useUnmuteConversationMutation();
  const { data: settings } = useNotificationSettings(open ? workspaceId : null);
  const { data: muted } = useMutedConversations(workspaceId);

  const label = conversationLabel(conversation);
  const override = conversation.notificationLevel ?? null;
  const mutedEntry = muted?.find((m) => m.conversationId === conversation.id);
  const mutedUntil =
    mutedEntry?.mutedUntil && isMuteActive(mutedEntry) ? mutedEntry.mutedUntil : null;

  const summary = mutedUntil
    ? `Muted until ${formatTime(mutedUntil)}`
    : LEVEL_LABELS[conversation.effectiveNotificationLevel];

  function chooseLevel(level: NotificationLevel | null) {
    onDone();
    setLevel.mutate(
      { serverId: workspaceId, conversationId: conversation.id, level },
      {
        onSuccess: (result) => {
          const shown = level
            ? LEVEL_LABELS[level]
            : `workspace default (${LEVEL_LABELS[result.effectiveLevel]})`;
          toast.success(`Notifications for ${label}: ${shown}`);
        },
        onError: (err) =>
          toast.error(graphqlErrorMessage(err, "Could not change the notification level")),
      },
    );
  }

  function muteUntil(until: Date) {
    onDone();
    mute.mutate(
      { serverId: workspaceId, conversationId: conversation.id, mutedUntil: until.toISOString() },
      {
        onSuccess: () => toast.success(`Muted ${label} until ${formatTime(until.toISOString())}`),
        onError: (err) => toast.error(graphqlErrorMessage(err, "Could not mute the conversation")),
      },
    );
  }

  const defaultLabel = settings
    ? `Use workspace default (${LEVEL_LABELS[settings.defaultLevel]})`
    : "Use workspace default";

  const items: DropdownMenuItem[] = [
    {
      id: "notifications-back",
      label: "Back",
      icon: <ChevronLeft className="h-4 w-4" />,
      onSelect: onBack,
    },
    ...LEVEL_ORDER.map((level) => ({
      id: `level-${level.toLowerCase()}`,
      label: LEVEL_LABELS[level],
      icon: markedIcon(override === level),
      onSelect: () => chooseLevel(level),
    })),
    {
      id: "level-default",
      label: defaultLabel,
      icon: markedIcon(override === null),
      onSelect: () => chooseLevel(null),
    },
  ];

  if (mutedUntil) {
    items.push({
      id: "unmute",
      label: `Unmute (muted until ${formatTime(mutedUntil)})`,
      icon: <Bell className="h-4 w-4" />,
      onSelect: () => {
        onDone();
        unmute.mutate(
          { serverId: workspaceId, conversationId: conversation.id },
          {
            onError: (err) =>
              toast.error(graphqlErrorMessage(err, "Could not unmute the conversation")),
          },
        );
      },
    });
  } else {
    items.push(
      ...MUTE_DURATIONS.map((duration) => ({
        id: duration.id,
        label: duration.label,
        icon: <Timer className="h-4 w-4" />,
        onSelect: () => muteUntil(duration.until()),
      })),
    );
  }

  return { summary, items };
}
