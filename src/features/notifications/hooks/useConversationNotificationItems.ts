import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import { toast } from "../../../shared/toast";
import { formatTime } from "../../../shared/utils/formatTime";
import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { NotificationLevel } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import {
  useMuteConversationMutation,
  useUnmuteConversationMutation,
} from "../../conversations/api/useMuteConversation";
import {
  isMuteActive,
  useMutedConversations,
  type MutedConversationItem,
} from "../../conversations/api/useMutedConversations";
import type { ConversationSummary } from "../../conversations/types";
import { conversationLabel } from "../../conversations/utils";
import { useSetConversationNotificationLevel } from "../api/useConversationNotificationLevel";
import {
  useNotificationSettings,
  type NotificationSettingsData,
} from "../api/useNotificationSettings";
import { inOneHour, tomorrowMorning } from "../rules";

export const LEVEL_LABELS: Record<NotificationLevel, string> = {
  [NotificationLevel.ALL]: "All messages",
  [NotificationLevel.MENTIONS]: "Mentions only",
  [NotificationLevel.NONE]: "Nothing",
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

/**
 * The notification items of a conversation's menu: Notifications, a submenu with the viewer's
 * level for the conversation (All messages, Mentions only, Nothing, or Workspace default with
 * the level it stands for; the one in effect checked) followed by the timed mutes, and, while
 * a timed mute lasts, Unmute in place of the mutes. The muted list and the default level are
 * read from the cache of the conversation's own workspace; those of `workspaceId` are kept
 * loaded.
 *
 * @returns A function that gives these items for a conversation the viewer is a member of.
 */
export function useConversationNotificationItems(
  workspaceId: string | null,
): (conversation: ConversationSummary) => DropdownMenuItem[] {
  const qc = useQueryClient();
  const { mutate: setLevel } = useSetConversationNotificationLevel();
  const { mutate: mute } = useMuteConversationMutation();
  const { mutate: unmute } = useUnmuteConversationMutation();
  useNotificationSettings(workspaceId);
  useMutedConversations(workspaceId ?? undefined);

  return useCallback(
    (conversation: ConversationSummary): DropdownMenuItem[] => {
      const serverId = conversation.serverId;
      const conversationId = conversation.id;
      const label = conversationLabel(conversation);
      const settings = qc.getQueryData<NotificationSettingsData>(
        queryKeys.notificationSettings(serverId),
      );
      const mutedEntry = qc
        .getQueryData<MutedConversationItem[]>(queryKeys.mutedConversations(serverId))
        ?.find((m) => m.conversationId === conversationId);
      const mutedUntil =
        mutedEntry?.mutedUntil && isMuteActive(mutedEntry) ? mutedEntry.mutedUntil : null;
      const override = conversation.notificationLevel ?? null;
      // Without an override of its own, the conversation's effective level is the default.
      const defaultLevel =
        settings?.defaultLevel ??
        (override === null && !mutedUntil ? conversation.effectiveNotificationLevel : undefined);

      function chooseLevel(level: NotificationLevel | null) {
        setLevel(
          { serverId, conversationId, level },
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
        mute(
          { serverId, conversationId, mutedUntil: until.toISOString() },
          {
            onSuccess: () =>
              toast.success(`Muted ${label} until ${formatTime(until.toISOString())}`),
            onError: (err) =>
              toast.error(graphqlErrorMessage(err, "Could not mute the conversation")),
          },
        );
      }

      const submenu: DropdownMenuItem[] = [
        ...LEVEL_ORDER.map((level) => ({
          id: `level-${level.toLowerCase()}`,
          label: LEVEL_LABELS[level],
          checked: override === level,
          onSelect: () => chooseLevel(level),
        })),
        {
          id: "level-default",
          label: "Workspace default",
          detail: defaultLevel ? LEVEL_LABELS[defaultLevel] : undefined,
          checked: override === null,
          onSelect: () => chooseLevel(null),
        },
      ];
      if (!mutedUntil) {
        submenu.push(
          ...MUTE_DURATIONS.map((duration, index) => ({
            id: duration.id,
            label: duration.label,
            separatorBefore: index === 0,
            onSelect: () => muteUntil(duration.until()),
          })),
        );
      }

      const items: DropdownMenuItem[] = [
        {
          id: "notifications",
          label: "Notifications",
          detail: mutedUntil
            ? `Muted until ${formatTime(mutedUntil)}`
            : LEVEL_LABELS[conversation.effectiveNotificationLevel],
          submenu,
        },
      ];
      if (mutedUntil) {
        items.push({
          id: "unmute",
          label: "Unmute",
          onSelect: () =>
            unmute(
              { serverId, conversationId },
              {
                onError: (err) =>
                  toast.error(graphqlErrorMessage(err, "Could not unmute the conversation")),
              },
            ),
        });
      }
      return items;
    },
    [qc, setLevel, mute, unmute],
  );
}
