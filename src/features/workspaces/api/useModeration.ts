import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import {
  PageDir,
  type DeletedMemberMessages,
  type MemberMessageCounts,
  type MessageReportStatus,
  type MutationBanMemberArgs,
  type MutationClearMessageFlagArgs,
  type MutationClearTimeoutArgs,
  type MutationDeleteMemberMessagesArgs,
  type MutationKickMemberArgs,
  type MutationDeleteMessageArgs,
  type MutationReportEncryptedMessageArgs,
  type MutationReportMessageArgs,
  type MutationResolveReportArgs,
  type MutationSetMemberRoleArgs,
  type MutationTimeoutMemberArgs,
  type MutationUnbanMemberArgs,
  type QueryMemberMessageCountsArgs,
  type ServerMemberRoleGql,
} from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { setMessageFlagged } from "../../../core/events/messageFlag";
import { toast } from "../../../shared/toast";
import { MESSAGE_FLAG, serverHasCapability } from "../../updater/api/serverCapabilities";
import { countOf, periodSince, type DeletePeriod } from "../memberMessages";

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

/** The variables of a page of reports. */
const MESSAGE_REPORTS_VARIABLES = `
    $serverId: ID!
    $status: MessageReportStatus
    $dir: PageDir!
    $cursor: MessageReportCursorInput
    $limit: Int!
`;

/** The arguments of `messageReports` in a page of reports. */
const MESSAGE_REPORTS_ARGUMENTS = `
      serverId: $serverId
      status: $status
      dir: $dir
      cursor: $cursor
      limit: $limit
`;

/** A page of reports' cursor and page info. */
const MESSAGE_REPORTS_PAGE_INFO = `
      next {
        createdAt
        reportId
      }
      pageInfo {
        hasNext
        hasPrev
      }
`;

const MESSAGE_REPORTS = gql`
  query MessageReports(${MESSAGE_REPORTS_VARIABLES}) {
    messageReports(${MESSAGE_REPORTS_ARGUMENTS}) {
      items {
        ...MessageReportRowFields
      }
      ${MESSAGE_REPORTS_PAGE_INFO}
    }
  }
  ${MESSAGE_REPORT_ROW_FIELDS}
`;

/** The same with `MessageReport.automatic`, for a server that lists `message_flag`. */
const MESSAGE_REPORTS_WITH_AUTOMATIC = gql`
  query MessageReportsWithAutomatic(${MESSAGE_REPORTS_VARIABLES}) {
    messageReports(${MESSAGE_REPORTS_ARGUMENTS}) {
      items {
        ...MessageReportRowFields
        automatic
      }
      ${MESSAGE_REPORTS_PAGE_INFO}
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
  query DirectSpaceMessageReports(${MESSAGE_REPORTS_VARIABLES}) {
    messageReports(${MESSAGE_REPORTS_ARGUMENTS}) {
      items {
        ...MessageReportRowFields
        messageAuthorPrincipalId
      }
      ${MESSAGE_REPORTS_PAGE_INFO}
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
      ...MessageReportRowFields
      frankedContent
    }
  }
  ${MESSAGE_REPORT_ROW_FIELDS}
`;

/** The same with `MessageReport.automatic`, for a server that lists `message_flag`. */
const MESSAGE_REPORT_WITH_AUTOMATIC = gql`
  query MessageReportWithAutomatic($serverId: ID!, $reportId: ID!) {
    messageReport(serverId: $serverId, reportId: $reportId) {
      ...MessageReportRowFields
      frankedContent
      automatic
    }
  }
  ${MESSAGE_REPORT_ROW_FIELDS}
`;

const CLEAR_MESSAGE_FLAG = gql`
  mutation ClearMessageFlag($serverId: ID!, $conversationId: ID!, $messageId: ID!) {
    clearMessageFlag(serverId: $serverId, conversationId: $conversationId, messageId: $messageId)
  }
`;

const MEMBER_MESSAGE_COUNTS = gql`
  query MemberMessageCounts($serverId: ID!, $userId: ID!, $since: DateTime) {
    memberMessageCounts(serverId: $serverId, userId: $userId, since: $since) {
      readable {
        messages
        channels
      }
      unjoinedPrivate {
        messages
        channels
      }
    }
  }
`;

const DELETE_MEMBER_MESSAGES = gql`
  mutation DeleteMemberMessages(
    $serverId: ID!
    $userId: ID!
    $since: DateTime
    $includeUnjoinedPrivate: Boolean!
  ) {
    deleteMemberMessages(
      serverId: $serverId
      userId: $userId
      since: $since
      includeUnjoinedPrivate: $includeUnjoinedPrivate
    ) {
      deleted
      channels
      hasMore
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
  /** The member who filed the report; null for a report the automatic check filed. */
  reporterUserId: string | null;
  /** Whether the automatic check filed the report; absent from a server without `message_flag`. */
  automatic?: boolean;
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
      const document = (await serverHasCapability(MESSAGE_FLAG))
        ? MESSAGE_REPORT_WITH_AUTOMATIC
        : MESSAGE_REPORT;
      const res = await graphqlClient.request<{ messageReport: MessageReportDetail }>(document, {
        serverId,
        reportId: reportId!,
      });
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
 * reports newest first; Load more fetches the older reports after the last cursor.
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
      const document = withAuthorPrincipal
        ? DIRECT_SPACE_MESSAGE_REPORTS
        : (await serverHasCapability(MESSAGE_FLAG))
          ? MESSAGE_REPORTS_WITH_AUTOMATIC
          : MESSAGE_REPORTS;
      const res = await graphqlClient.request<{ messageReports: MessageReportPage }>(document, {
        serverId: id!,
        status,
        dir: PageDir.AFTER,
        cursor: pageParam,
        limit: REPORTS_PAGE_SIZE,
      });
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

/**
 * An Owner or Moderator clears the automatic check's flag on a message: the message shows
 * uncovered for everyone, and "Flag cleared" or the server's refusal is said in a toast.
 */
export function useClearMessageFlag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: MutationClearMessageFlagArgs) =>
      graphqlClient.request<{ clearMessageFlag: boolean }>(CLEAR_MESSAGE_FLAG, vars),
    onSuccess: (_data, vars) => {
      setMessageFlagged(qc, vars.serverId, vars.conversationId, vars.messageId, false);
      toast.success("Flag cleared");
    },
    onError: (err) => toast.error(graphqlErrorMessage(err, "Could not clear the flag")),
  });
}

/**
 * Most `deleteMemberMessages` calls one deletion makes (1000 each) before it stops and says more
 * remain.
 */
export const MAX_DELETE_ROUNDS = 50;

/** What one deletion of a person's messages did. */
export interface MemberMessagesDeleted {
  /** Messages deleted over every call. */
  deleted: number;
  /** Whether matching messages remain after the last call. */
  hasMore: boolean;
}

/** A person's message counts, with the `since` they were asked for. */
export interface MemberMessageCountsResult {
  counts: MemberMessageCounts;
  /** The bound the counts were asked with, which the delete then sends. */
  since: string | null;
}

/**
 * Deletes a person's messages, calling `deleteMemberMessages` again while more remain, at most
 * {@link MAX_DELETE_ROUNDS} times; stops early when a call deletes nothing.
 *
 * @returns How many were deleted, and whether more remain.
 * @throws The first call's error unchanged; a later call's error as an `Error` that names how
 * many were already deleted.
 */
export async function deleteAllMemberMessages(
  vars: MutationDeleteMemberMessagesArgs,
): Promise<MemberMessagesDeleted> {
  let deleted = 0;
  try {
    for (let round = 0; round < MAX_DELETE_ROUNDS; round += 1) {
      const res = (
        await graphqlClient.request<{ deleteMemberMessages: DeletedMemberMessages }>(
          DELETE_MEMBER_MESSAGES,
          vars,
        )
      ).deleteMemberMessages;
      deleted += res.deleted;
      if (!res.hasMore || res.deleted === 0) return { deleted, hasMore: res.hasMore };
    }
  } catch (err) {
    if (deleted === 0) throw err;
    throw new Error(
      `Deleted ${countOf(deleted, "message")}, then: ${graphqlErrorMessage(err, "the rest could not be deleted")}`,
      { cause: err },
    );
  }
  return { deleted, hasMore: true };
}

/**
 * How many of a person's messages a delete over `period` would reach; not fetched for `none`,
 * never cached once no dialog shows it.
 */
export function useMemberMessageCounts(serverId: string, userId: string, period: DeletePeriod) {
  return useQuery({
    queryKey: queryKeys.memberMessageCounts(serverId, userId, period),
    enabled: period !== "none",
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<MemberMessageCountsResult> => {
      const since = periodSince(period);
      const res = await graphqlClient.request<{ memberMessageCounts: MemberMessageCounts }>(
        MEMBER_MESSAGE_COUNTS,
        { serverId, userId, since } satisfies QueryMemberMessageCountsArgs,
      );
      return { counts: res.memberMessageCounts, since };
    },
  });
}

/** Deletes a person's messages with {@link deleteAllMemberMessages}, then drops their counts. */
export function useDeleteMemberMessages() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteAllMemberMessages,
    onSettled: (_data, _error, vars) => {
      void qc.invalidateQueries({ queryKey: ["memberMessageCounts", vars.serverId, vars.userId] });
    },
  });
}
