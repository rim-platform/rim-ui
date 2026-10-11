import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import { TypedVerbGql } from "../../../core/graphql/generated/schema-types";
import type { AuditLogEntry, AuditLogPageInfo } from "../../../core/graphql/generated/schema-types";

export type { AuditLogEntry, TypedVerbGql };

export interface AuditLogPage {
  items: AuditLogEntry[];
  nextCursor: string | null;
  pageInfo: AuditLogPageInfo;
}

const LIST_AUDIT_LOG = gql`
  query ListAuditLog($filter: AuditLogFilterInput, $pagination: AuditLogPaginationInput) {
    listAuditLog(filter: $filter, pagination: $pagination) {
      items {
        id
        actorUserId
        serverId
        commandId
        initiator
        argsRedacted
        sensitivity
        dangerous
        confirmationKind
        typedVerb
        outcome
        errorKind
        capabilityCheckOutcome
        confirmationOutcome
        createdAt
      }
      nextCursor
      pageInfo {
        hasNextPage
        hasPrevPage
      }
    }
  }
`;

/**
 * Which rows to read. `serverId` alone reads a whole workspace's log (Owners and Moderators);
 * `actorUserId` reads one user's own rows, within `serverId` when it is set too.
 */
export interface AuditLogScope {
  serverId: string | null;
  actorUserId: string | null;
}

export interface ListAuditLogArgs {
  /** The rows to read; `null` while the scope is still unknown, which holds the request. */
  scope: AuditLogScope | null;
  typedVerbFilter?: TypedVerbGql | null;
  after?: string | null;
  limit?: number;
}

export function useListAuditLog({
  scope,
  typedVerbFilter = null,
  after = null,
  limit = 50,
}: ListAuditLogArgs) {
  const serverId = scope?.serverId ?? null;
  const actorUserId = scope?.actorUserId ?? null;
  const filter = {
    ...(serverId != null && { serverId }),
    ...(actorUserId != null && { actorUserId }),
    ...(typedVerbFilter != null && { typedVerb: typedVerbFilter }),
  };
  const pagination = after != null ? { after, limit } : { limit };

  return useQuery({
    queryKey: queryKeys.listAuditLog(
      serverId ?? undefined,
      actorUserId ?? undefined,
      typedVerbFilter ?? undefined,
      after ?? undefined,
    ),
    enabled: serverId != null || actorUserId != null,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const res = await graphqlClient.request<{ listAuditLog: AuditLogPage }>(LIST_AUDIT_LOG, {
        filter,
        pagination,
      });
      return res.listAuditLog;
    },
  });
}
