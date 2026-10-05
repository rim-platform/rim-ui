import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import type {
  DigestFrequency,
  NotificationLevel,
  UpdateNotificationSettingsInput,
} from "../../../core/graphql/generated/schema-types";

const NOTIFICATION_SETTINGS_FIELDS = gql`
  fragment NotificationSettingsFields on NotificationSettings {
    serverId
    defaultLevel
    keywords
    dnd {
      start
      end
      timezone
    }
    dndPaused
    dndPausedUntil
    digest
  }
`;

const MY_NOTIFICATION_SETTINGS = gql`
  query MyNotificationSettings($serverId: ID!) {
    myNotificationSettings(serverId: $serverId) {
      ...NotificationSettingsFields
    }
  }
  ${NOTIFICATION_SETTINGS_FIELDS}
`;

const UPDATE_NOTIFICATION_SETTINGS = gql`
  mutation UpdateNotificationSettings($serverId: ID!, $input: UpdateNotificationSettingsInput!) {
    updateNotificationSettings(serverId: $serverId, input: $input) {
      ...NotificationSettingsFields
    }
  }
  ${NOTIFICATION_SETTINGS_FIELDS}
`;

const SET_DO_NOT_DISTURB = gql`
  mutation SetDoNotDisturb($serverId: ID!, $paused: Boolean!, $until: DateTime) {
    setDoNotDisturb(serverId: $serverId, paused: $paused, until: $until) {
      ...NotificationSettingsFields
    }
  }
  ${NOTIFICATION_SETTINGS_FIELDS}
`;

/** The viewer's notification settings in one workspace, as the server returns them. */
export interface NotificationSettingsData {
  serverId: string;
  defaultLevel: NotificationLevel;
  keywords: string[];
  dnd: { start: string; end: string; timezone: string } | null;
  dndPaused: boolean;
  dndPausedUntil: string | null;
  digest: DigestFrequency;
}

/** The viewer's server-side notification settings for the workspace (defaults until saved). */
export function useNotificationSettings(serverId?: string | null) {
  const ws = serverId ?? undefined;
  return useQuery({
    queryKey: queryKeys.notificationSettings(ws),
    enabled: Boolean(ws),
    staleTime: 60_000,
    queryFn: async () => {
      const res = await graphqlClient.request<{ myNotificationSettings: NotificationSettingsData }>(
        MY_NOTIFICATION_SETTINGS,
        { serverId: ws! },
      );
      return res.myNotificationSettings;
    },
  });
}

interface UpdateNotificationSettingsVars {
  serverId: string;
  input: UpdateNotificationSettingsInput;
}

/**
 * Replaces the editable settings (default level, keywords, daily window, digest). The pause is
 * left alone; the answer replaces the cached settings. Changing the default level changes the
 * effective level of every conversation without its own, so the conversation caches refetch.
 */
export function useUpdateNotificationSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ serverId, input }: UpdateNotificationSettingsVars) => {
      const res = await graphqlClient.request<{
        updateNotificationSettings: NotificationSettingsData;
      }>(UPDATE_NOTIFICATION_SETTINGS, { serverId, input });
      return res.updateNotificationSettings;
    },
    onSuccess: (settings, { serverId }) => {
      qc.setQueryData(queryKeys.notificationSettings(serverId), settings);
      qc.invalidateQueries({ queryKey: queryKeys.channels(serverId) });
      qc.invalidateQueries({ queryKey: queryKeys.conversations(serverId) });
      qc.invalidateQueries({ queryKey: ["conversation", serverId] });
    },
  });
}

interface SetDoNotDisturbVars {
  serverId: string;
  paused: boolean;
  /** RFC 3339 end of the pause; null pauses until turned off. Ignored when `paused` is false. */
  until: string | null;
}

/** Turns the manual do-not-disturb pause on (until an instant or until turned off) or off. */
export function useSetDoNotDisturb() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ serverId, paused, until }: SetDoNotDisturbVars) => {
      const res = await graphqlClient.request<{ setDoNotDisturb: NotificationSettingsData }>(
        SET_DO_NOT_DISTURB,
        { serverId, paused, until: paused ? until : null },
      );
      return res.setDoNotDisturb;
    },
    onSuccess: (settings, { serverId }) => {
      qc.setQueryData(queryKeys.notificationSettings(serverId), settings);
    },
  });
}
