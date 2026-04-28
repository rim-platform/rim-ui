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
  query ListAuditLog(
    $filter: AuditLogFilterInput
    $pagination: AuditLogPaginationInput
  ) {
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

export interface ListAuditLogArgs {
  typedVerbFilter?: TypedVerbGql | null;
  after?: string | null;
  limit?: number;
}

export function useListAuditLog({
  typedVerbFilter = null,
  after = null,
  limit = 50,
}: ListAuditLogArgs = {}) {
  const filter = typedVerbFilter != null ? { typedVerb: typedVerbFilter } : {};
  const pagination = after != null ? { after, limit } : { limit };

  return useQuery({
    queryKey: queryKeys.listAuditLog(typedVerbFilter ?? undefined, after ?? undefined),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const res = await graphqlClient.request<{ listAuditLog: AuditLogPage }>(
        LIST_AUDIT_LOG,
        {
          filter: Object.keys(filter).length > 0 ? filter : null,
          pagination,
        },
      );
      return res.listAuditLog;
    },
  });
}
