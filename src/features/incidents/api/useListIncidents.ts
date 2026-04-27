import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import type {
  IncidentGql,
  IncidentSeverityGql,
  IncidentStatusGql,
} from "../../../core/graphql/generated/schema-types";

// `listIncidents` and the `IncidentPage` / `IncidentListCursor*` types were
// added to the backend after the local schema.graphql was last regenerated;
// the rim-server DB env is misconfigured locally, so codegen could not run.
// Inline these types verbatim against doctor-strange's documented contract;
// drop them in favor of the generated equivalents on the next codegen pass.
//
// Schema (rim_api/src/types.rs):
//   type IncidentPage {
//     items: [IncidentGql!]!
//     next: IncidentListCursorOutput
//     prev: IncidentListCursorOutput
//     pageInfo: PageInfo!
//   }
//   input IncidentListCursorInput  { createdAt: DateTime!, incidentId: ID! }
//   type IncidentListCursorOutput  { createdAt: DateTime!, incidentId: ID! }

export interface IncidentListCursor {
  createdAt: string;
  incidentId: string;
}

export interface IncidentPage {
  items: IncidentGql[];
  next: IncidentListCursor | null;
  prev: IncidentListCursor | null;
  pageInfo: { hasNext: boolean; hasPrev: boolean };
}

export type PageDir = "AFTER" | "BEFORE";

const LIST_INCIDENTS = gql`
  query ListIncidents(
    $serverId: ID!
    $statusFilter: [IncidentStatusGql!]
    $severityFilter: [IncidentSeverityGql!]
    $dir: PageDir!
    $cursor: IncidentListCursorInput
    $limit: Int
  ) {
    listIncidents(
      serverId: $serverId
      statusFilter: $statusFilter
      severityFilter: $severityFilter
      dir: $dir
      cursor: $cursor
      limit: $limit
    ) {
      items {
        id
        serverId
        conversationId
        title
        status
        severity
        startedAt
        mitigatedAt
        resolvedAt
        createdAt
      }
      next {
        createdAt
        incidentId
      }
      prev {
        createdAt
        incidentId
      }
      pageInfo {
        hasNext
        hasPrev
      }
    }
  }
`;

export interface ListIncidentsArgs {
  serverId: string | null | undefined;
  statusFilter?: IncidentStatusGql[] | null;
  severityFilter?: IncidentSeverityGql[] | null;
  cursor?: IncidentListCursor | null;
  dir?: PageDir;
  limit?: number;
}

export function useListIncidents({
  serverId,
  statusFilter,
  severityFilter,
  cursor = null,
  dir = "AFTER",
  limit = 20,
}: ListIncidentsArgs) {
  // Filter arrays are passed as `null` when empty so the backend treats them
  // as "no filter on this field" (per strange's filter semantics: empty array
  // would still be accepted but null is the documented "no filter" signal).
  const status = statusFilter && statusFilter.length > 0 ? statusFilter : null;
  const severity =
    severityFilter && severityFilter.length > 0 ? severityFilter : null;

  return useQuery({
    queryKey: [
      ...queryKeys.listIncidents(
        serverId ?? undefined,
        status ?? undefined,
        severity ?? undefined,
      ),
      dir,
      cursor?.incidentId ?? null,
    ] as const,
    enabled: Boolean(serverId),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const res = await graphqlClient.request<{ listIncidents: IncidentPage }>(
        LIST_INCIDENTS,
        {
          serverId: serverId!,
          statusFilter: status,
          severityFilter: severity,
          dir,
          cursor,
          limit,
        },
      );
      return res.listIncidents;
    },
  });
}
