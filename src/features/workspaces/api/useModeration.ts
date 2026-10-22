import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import {
  PageDir,
  type MessageReportStatus,
  type MutationBanMemberArgs,
  type MutationClearTimeoutArgs,
  type MutationKickMemberArgs,
  type MutationDeleteMessageArgs,
  type MutationReportEncryptedMessageArgs,
  type MutationReportMessageArgs,
  type MutationResolveReportArgs,
  type MutationSetMemberRoleArgs,
  type MutationTimeoutMemberArgs,
  type MutationUnbanMemberArgs,
  type ServerMemberRoleGql,
} from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";

/**
 * Moderation calls: member role changes, kick, ban, timeout, reports. Every mutation is
 * re-checked server-side (role ladder, targeting rules); the UI gates are only there to avoid
 * offering what would fail.
 */

const SET_MEMBER_ROLE = gql`
  mutation SetMemberRole($serverId: ID!, $userId: ID!, $role: ServerMemberRoleGql!) {
    setMemberRole(serverId: $serverId, userId: $userId, role: $role) {
      userId
      memberRole
    }
  }
`;

const KICK_MEMBER = gql`
  mutation KickMember($serverId: ID!, $userId: ID!, $reason: String) {
    kickMember(serverId: $serverId, userId: $userId, reason: $reason)
  }
`;

const BAN_MEMBER = gql`
  mutation BanMember($serverId: ID!, $userId: ID!, $reason: String, $expiresAt: DateTime) {
    banMember(serverId: $serverId, userId: $userId, reason: $reason, expiresAt: $expiresAt) {
      userId
      expiresAt
    }
  }
`;

const UNBAN_MEMBER = gql`
  mutation UnbanMember($serverId: ID!, $userId: ID!) {
    unbanMember(serverId: $serverId, userId: $userId)
  }
`;

const TIMEOUT_MEMBER = gql`
  mutation TimeoutMember($serverId: ID!, $userId: ID!, $until: DateTime!, $reason: String) {
    timeoutMember(serverId: $serverId, userId: $userId, until: $until, reason: $reason) {
      userId
      until
    }
  }
`;

const CLEAR_TIMEOUT = gql`
  mutation ClearTimeout($serverId: ID!, $userId: ID!) {
    clearTimeout(serverId: $serverId, userId: $userId)
  }
`;

const SERVER_BANS = gql`
  query ServerBans($serverId: ID!) {
    serverBans(serverId: $serverId) {
      userId
      reason
      bannedBy
      createdAt
      expiresAt
      user {
        id
        username
        displayName
        avatarUrl
      }
    }
  }
`;

const REPORT_MESSAGE = gql`
  mutation ReportMessage($serverId: ID!, $conversationId: ID!, $messageId: ID!, $reason: String!) {
    reportMessage(
      serverId: $serverId
      conversationId: $conversationId
      messageId: $messageId
      reason: $reason
    ) {
      id
    }
  }
`;

const MESSAGE_REPORT_ROW_FIELDS = gql`
  fragment MessageReportRowFields on MessageReport {
    id
    conversationId
    messageId
    reporterUserId
    reason
    status
    resolvedBy
    resolvedAt
    createdAt
    messageReadable
    messageText
    messageAuthorId
    messageSentAt
    frankingVerifiedAt
    frankedSenderDeviceId
    frankedContentExpiresAt
  }
`;

const MESSAGE_REPORTS = gql`
  query MessageReports(
    $serverId: ID!
    $status: MessageReportStatus
    $dir: PageDir!
    $cursor: MessageReportCursorInput
    $limit: Int!
  ) {
    messageReports(
      serverId: $serverId
      status: $status
      dir: $dir
      cursor: $cursor
      limit: $limit
    ) {
      items {
        ...MessageReportRowFields
      }
      next {
        createdAt
        reportId
      }
      pageInfo {
        hasNext
        hasPrev
      }
    }
  }
  ${MESSAGE_REPORT_ROW_FIELDS}
`;

/**
 * `MESSAGE_REPORTS` with each author's principal id, which the server fills for an instance
 * operator reading the direct space's reports. A query of its own so a workspace's moderation
 * keeps working against a server without the field.
 */
const DIRECT_SPACE_MESSAGE_REPORTS = gql`
  query DirectSpaceMessageReports(
    $serverId: ID!
    $status: MessageReportStatus
    $dir: PageDir!
    $cursor: MessageReportCursorInput
    $limit: Int!
  ) {
    messageReports(
      serverId: $serverId
      status: $status
      dir: $dir
      cursor: $cursor
      limit: $limit
    ) {
      items {
        ...MessageReportRowFields
        messageAuthorPrincipalId
      }
      next {
        createdAt
        reportId
      }
      pageInfo {
        hasNext
        hasPrev
      }
    }
  }
  ${MESSAGE_REPORT_ROW_FIELDS}
`;

const REPORT_ENCRYPTED_MESSAGE = gql`
  mutation ReportEncryptedMessage($input: ReportEncryptedMessageInput!) {
    reportEncryptedMessage(input: $input)
  }
`;

const MESSAGE_REPORT = gql`
  query MessageReport($serverId: ID!, $reportId: ID!) {
    messageReport(serverId: $serverId, reportId: $reportId) {
      id
      conversationId
      messageId
      reporterUserId
      reason
      status
      resolvedBy
      resolvedAt
      createdAt
      messageReadable
      messageText
      messageAuthorId
      messageSentAt
      frankingVerifiedAt
      frankedSenderDeviceId
      frankedContentExpiresAt
      frankedContent
    }
  }
`;

const DELETE_REPORTED_MESSAGE = gql`
  mutation DeleteReportedMessage($input: DeleteMessageInput!) {
    deleteMessage(input: $input)
  }
`;

const RESOLVE_REPORT = gql`
  mutation ResolveReport($serverId: ID!, $reportId: ID!, $outcome: ReportOutcome!) {
    resolveReport(serverId: $serverId, reportId: $reportId, outcome: $outcome) {
      id
      status
    }
  }
`;

export interface ServerBanRow {
  userId: string;
  reason: string | null;
  bannedBy: string | null;
  createdAt: string;
  expiresAt: string | null;
  user: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  } | null;
}

export interface MessageReportRow {
  id: string;
  conversationId: string;
  messageId: string;
  reporterUserId: string;
  reason: string;
  status: MessageReportStatus;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  messageReadable: boolean;
  /**
   * The reported message's text: when the moderator reads the conversation, and for an
   * instance operator on a report of an unencrypted message of the direct space.
   */
  messageText: string | null;
  messageAuthorId: string | null;
  /**
   * The author's principal id, which an instance operator can block; asked for only on the
   * direct space's reports.
   */
  messageAuthorPrincipalId?: string | null;
  messageSentAt: string | null;
  /** Set for a verified report of an encrypted message. */
  frankingVerifiedAt: string | null;
  frankedSenderDeviceId: string | null;
  /** When the verified content is deleted from the server; null while the report is open. */
  frankedContentExpiresAt: string | null;
}

/** One report as `messageReport` answers it, with the verified content of an encrypted one. */
export interface MessageReportDetail extends MessageReportRow {
  /** The exact content bytes (base64url); null for a plaintext report or once deleted. */
  frankedContent: string | null;
}

export interface MessageReportPage {
  items: MessageReportRow[];
  next: { createdAt: string; reportId: string } | null;
  pageInfo: { hasNext: boolean; hasPrev: boolean };
}

export const REPORTS_PAGE_SIZE = 20;

/** Refreshes the member directory: roles, timeouts and membership all live there. */
function useInvalidateMembers() {
  const qc = useQueryClient();
  return (serverId: string) =>
    qc.invalidateQueries({ queryKey: queryKeys.serverMembers(serverId) });
}

export function useSetMemberRoleMutation() {
  const invalidate = useInvalidateMembers();
  return useMutation({
    mutationFn: (vars: MutationSetMemberRoleArgs) =>
      graphqlClient.request<{ setMemberRole: { userId: string; memberRole: ServerMemberRoleGql } }>(
        SET_MEMBER_ROLE,
        vars,
      ),
    onSuccess: (_data, vars) => invalidate(vars.serverId),
  });
}

export function useKickMemberMutation() {
  const invalidate = useInvalidateMembers();
  return useMutation({
    mutationFn: (vars: MutationKickMemberArgs) =>
      graphqlClient.request<{ kickMember: boolean }>(KICK_MEMBER, vars),
    onSuccess: (_data, vars) => invalidate(vars.serverId),
  });
}

export function useBanMemberMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: MutationBanMemberArgs) =>
      graphqlClient.request<{ banMember: { userId: string; expiresAt: string | null } }>(
        BAN_MEMBER,
        vars,
      ),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.serverMembers(vars.serverId) });
      qc.invalidateQueries({ queryKey: queryKeys.serverBans(vars.serverId) });
    },
  });
}

export function useUnbanMemberMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: MutationUnbanMemberArgs) =>
      graphqlClient.request<{ unbanMember: boolean }>(UNBAN_MEMBER, vars),
    onSuccess: (_data, vars) => {
      qc.setQueryData<ServerBanRow[]>(queryKeys.serverBans(vars.serverId), (old) =>
        old?.filter((ban) => ban.userId !== vars.userId),
      );
      qc.invalidateQueries({ queryKey: queryKeys.serverBans(vars.serverId) });
    },
  });
}

export function useTimeoutMemberMutation() {
  const invalidate = useInvalidateMembers();
  return useMutation({
    mutationFn: (vars: MutationTimeoutMemberArgs) =>
      graphqlClient.request<{ timeoutMember: { userId: string; until: string } }>(
        TIMEOUT_MEMBER,
        vars,
      ),
    onSuccess: (_data, vars) => invalidate(vars.serverId),
  });
}

export function useClearTimeoutMutation() {
  const invalidate = useInvalidateMembers();
  return useMutation({
    mutationFn: (vars: MutationClearTimeoutArgs) =>
      graphqlClient.request<{ clearTimeout: boolean }>(CLEAR_TIMEOUT, vars),
    onSuccess: (_data, vars) => invalidate(vars.serverId),
  });
}

/** Active bans of the workspace, newest first (Owner/Moderator only). */
export function useServerBans(serverId: string | null | undefined, enabled = true) {
  const id = serverId ?? undefined;
  return useQuery({
    queryKey: queryKeys.serverBans(id),
    enabled: Boolean(id) && enabled,
    queryFn: async () => {
      const res = await graphqlClient.request<{ serverBans: ServerBanRow[] }>(SERVER_BANS, {
        serverId: id!,
      });
      return res.serverBans;
    },
  });
}

/** Any member reports a message they can read to the workspace moderators. */
export function useReportMessageMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: MutationReportMessageArgs) =>
      graphqlClient.request<{ reportMessage: { id: string } }>(REPORT_MESSAGE, vars),
    onSuccess: (_data, vars) =>
      qc.invalidateQueries({ queryKey: ["messageReports", vars.serverId] }),
  });
}

/** A member reports an encrypted message by revealing its content, franking key and receipt. */
export function useReportEncryptedMessageMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: MutationReportEncryptedMessageArgs) =>
      graphqlClient.request<{ reportEncryptedMessage: boolean }>(REPORT_ENCRYPTED_MESSAGE, vars),
    onSuccess: (_data, vars) =>
      qc.invalidateQueries({ queryKey: ["messageReports", vars.input.serverId] }),
  });
}

/**
 * One report with the verified content of an encrypted message (Owner/Moderator). Every fetch
 * is recorded in the audit log as the moderator viewing the content, so it is fetched once per
 * opening and never refetched in the background.
 */
export function useMessageReport(serverId: string, reportId: string | null) {
  return useQuery({
    queryKey: queryKeys.messageReport(serverId, reportId ?? undefined),
    enabled: Boolean(reportId),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async () => {
      const res = await graphqlClient.request<{ messageReport: MessageReportDetail }>(
        MESSAGE_REPORT,
        { serverId, reportId: reportId! },
      );
      return res.messageReport;
    },
  });
}

/** A moderator deletes a reported message, also from a conversation they are not in. */
export function useDeleteReportedMessageMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: MutationDeleteMessageArgs) =>
      graphqlClient.request<{ deleteMessage: boolean }>(DELETE_REPORTED_MESSAGE, vars),
    onSuccess: (_data, vars) =>
      qc.invalidateQueries({ queryKey: ["messageReports", vars.input.serverId] }),
  });
}

/**
 * Message reports of the workspace, filtered by status (`null` = all). The server orders
 * reports oldest first and has no "newest page" entry point (an uncursored `BEFORE` also
 * starts at the oldest), so the list reads as a queue: oldest first, Load more for newer.
 * `withAuthorPrincipal` also asks for each author's principal id (the direct space's reports,
 * read by an instance operator).
 */
export function useMessageReports(
  serverId: string | null | undefined,
  status: MessageReportStatus | null,
  enabled = true,
  withAuthorPrincipal = false,
) {
  const id = serverId ?? undefined;
  return useInfiniteQuery({
    queryKey: queryKeys.messageReports(id, status, withAuthorPrincipal),
    enabled: Boolean(id) && enabled,
    initialPageParam: null as MessageReportPage["next"],
    queryFn: async ({ pageParam }) => {
      const res = await graphqlClient.request<{ messageReports: MessageReportPage }>(
        withAuthorPrincipal ? DIRECT_SPACE_MESSAGE_REPORTS : MESSAGE_REPORTS,
        {
          serverId: id!,
          status,
          dir: PageDir.AFTER,
          cursor: pageParam,
          limit: REPORTS_PAGE_SIZE,
        },
      );
      return res.messageReports;
    },
    getNextPageParam: (lastPage) => (lastPage.pageInfo.hasNext ? lastPage.next : null),
  });
}

export function useResolveReportMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: MutationResolveReportArgs) =>
      graphqlClient.request<{ resolveReport: { id: string; status: MessageReportStatus } }>(
        RESOLVE_REPORT,
        vars,
      ),
    onSuccess: (_data, vars) =>
      qc.invalidateQueries({ queryKey: ["messageReports", vars.serverId] }),
  });
}
