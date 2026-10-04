import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import type {
  CreateIngestTokenInput,
  IncidentSeverityGql,
} from "../../../core/graphql/generated/schema-types";

const INGEST_TOKEN_FIELDS = gql`
  fragment IngestTokenFields on IngestTokenGql {
    id
    serverId
    conversationId
    createdBy
    label
    severityDefault
    createdAt
    revokedAt
    lastUsedAt
  }
`;

const INGEST_TOKENS_QUERY = gql`
  query IngestTokens($serverId: ID!) {
    ingestTokens(serverId: $serverId) {
      ...IngestTokenFields
    }
  }
  ${INGEST_TOKEN_FIELDS}
`;

const CREATE_INGEST_TOKEN_MUTATION = gql`
  mutation CreateIngestToken($input: CreateIngestTokenInput!) {
    createIngestToken(input: $input) {
      rawToken
      token {
        ...IngestTokenFields
      }
    }
  }
  ${INGEST_TOKEN_FIELDS}
`;

const REVOKE_INGEST_TOKEN_MUTATION = gql`
  mutation RevokeIngestToken($tokenId: ID!) {
    revokeIngestToken(tokenId: $tokenId)
  }
`;

/** An alert-ingest token, as returned by the `ingestTokens` query. Never carries the raw token value — see {@link CreateIngestTokenResult}. */
export interface IngestToken {
  id: string;
  serverId: string;
  conversationId: string;
  createdBy: string;
  label: string;
  severityDefault: IncidentSeverityGql | null;
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

/** Result of {@link useCreateIngestToken}'s mutation. `rawToken` is surfaced exactly once — the backend never returns it again. */
export interface CreateIngestTokenResult {
  rawToken: string;
  token: IngestToken;
}

interface IngestTokensResponse {
  ingestTokens: IngestToken[];
}

/**
 * Lists the active and revoked alert-ingest tokens for a workspace (Track B2).
 * Owner-only on the backend; the query simply returns empty/forbidden for a
 * non-owner today (see `docs/integrations-ui.md` for the client-gating gap).
 */
export function useIngestTokens(serverId?: string) {
  return useQuery({
    queryKey: queryKeys.ingestTokens(serverId),
    enabled: Boolean(serverId),
    staleTime: 15_000,
    queryFn: async () => {
      const res = await graphqlClient.request<IngestTokensResponse>(INGEST_TOKENS_QUERY, {
        serverId: serverId!,
      });
      return res.ingestTokens;
    },
  });
}

/**
 * Creates a new alert-ingest token. The result's `rawToken` must be shown to
 * the user immediately and never refetched — the backend only stores its
 * hash. Invalidates {@link useIngestTokens} for the token's workspace on
 * success.
 */
export function useCreateIngestToken() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateIngestTokenInput) =>
      graphqlClient
        .request<{ createIngestToken: CreateIngestTokenResult }>(CREATE_INGEST_TOKEN_MUTATION, {
          input,
        })
        .then((res) => res.createIngestToken),
    onSuccess: (_result, input) => {
      qc.invalidateQueries({ queryKey: queryKeys.ingestTokens(input.serverId) });
    },
  });
}

/** Revokes an alert-ingest token. Invalidates {@link useIngestTokens} for its workspace on success. */
export function useRevokeIngestToken() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (vars: { serverId: string; tokenId: string }) =>
      graphqlClient.request<{ revokeIngestToken: boolean }>(REVOKE_INGEST_TOKEN_MUTATION, {
        tokenId: vars.tokenId,
      }),
    onSuccess: (_result, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.ingestTokens(vars.serverId) });
    },
  });
}
