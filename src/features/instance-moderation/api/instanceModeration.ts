import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { FORBIDDEN, graphqlErrorCode, isSchemaRefusal } from "../../../core/graphql/errors";
import type {
  InstanceAbuseReport,
  InstanceIpBlock,
  InstanceIpBlockOutcome,
  InstancePrincipalBlock,
  InstancePrincipalBlockOutcome,
  InstancePrincipalUnblockOutcome,
  MutationInstanceBlockIpArgs,
  MutationInstanceBlockPrincipalArgs,
  MutationInstanceResolveReportArgs,
  MutationInstanceUnblockIpArgs,
  MutationInstanceUnblockPrincipalArgs,
} from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { useAuthStore } from "../../auth/state/useAuthStore";

/**
 * The instance moderation queue: abuse reports, blocked principals and the IP deny list. Every
 * root answers `FORBIDDEN` to anyone but an instance operator.
 */

const INSTANCE_OPERATOR = gql`
  query ViewerInstanceOperator {
    me {
      id
      instanceOperator
    }
  }
`;

const INSTANCE_REPORT_FIELDS = gql`
  fragment InstanceReportFields on InstanceAbuseReport {
    id
    reporterUserId
    reporterUsername
    subjectPrincipalId
    subjectUsername
    subjectServerId
    requestId
    reason
    createdAt
    resolvedAt
    resolved
  }
`;

const INSTANCE_ACCOUNT_FIELDS = gql`
  fragment InstanceAccountFields on InstanceAccount {
    userId
    username
    principalId
    createdAt
  }
`;

const INSTANCE_IP_BLOCK_FIELDS = gql`
  fragment InstanceIpBlockFields on InstanceIpBlock {
    cidr
    reason
    expiresAt
    createdAt
    expired
  }
`;

const INSTANCE_REPORTS = gql`
  query InstanceReports($openOnly: Boolean!) {
    instanceReports(openOnly: $openOnly) {
      ...InstanceReportFields
    }
  }
  ${INSTANCE_REPORT_FIELDS}
`;

const INSTANCE_PRINCIPAL_BLOCKS = gql`
  query InstancePrincipalBlocks {
    instancePrincipalBlocks {
      principalId
      username
      reason
      createdAt
    }
  }
`;

const INSTANCE_IP_BLOCKS = gql`
  query InstanceIpBlocks {
    instanceIpBlocks {
      ...InstanceIpBlockFields
    }
  }
  ${INSTANCE_IP_BLOCK_FIELDS}
`;

const RESOLVE_REPORT = gql`
  mutation InstanceResolveReport($id: ID!) {
    instanceResolveReport(id: $id) {
      ...InstanceReportFields
    }
  }
  ${INSTANCE_REPORT_FIELDS}
`;

const BLOCK_PRINCIPAL = gql`
  mutation InstanceBlockPrincipal($principalId: String!, $reason: String!, $cascade: Boolean!) {
    instanceBlockPrincipal(principalId: $principalId, reason: $reason, cascade: $cascade) {
      principalId
      newlyBlocked
      account {
        ...InstanceAccountFields
      }
      reason
      endedSessions
      ignoredRequests
      revokedInvites
      emailBlocked
      invitees {
        ...InstanceAccountFields
      }
    }
  }
  ${INSTANCE_ACCOUNT_FIELDS}
`;

const UNBLOCK_PRINCIPAL = gql`
  mutation InstanceUnblockPrincipal($principalId: String!) {
    instanceUnblockPrincipal(principalId: $principalId) {
      lifted
      emailUnblocked
    }
  }
`;

const BLOCK_IP = gql`
  mutation InstanceBlockIp($cidr: String!, $reason: String!, $expiresInDays: Int) {
    instanceBlockIp(cidr: $cidr, reason: $reason, expiresInDays: $expiresInDays) {
      block {
        ...InstanceIpBlockFields
      }
      newlyBlocked
    }
  }
  ${INSTANCE_IP_BLOCK_FIELDS}
`;

const UNBLOCK_IP = gql`
  mutation InstanceUnblockIp($cidr: String!) {
    instanceUnblockIp(cidr: $cidr)
  }
`;

/** Whether a failed request was refused because the caller is not an instance operator. */
export function isOperatorRefusal(err: unknown): boolean {
  return graphqlErrorCode(err) === FORBIDDEN;
}

/**
 * Whether the signed-in account is an instance operator. A server without the field answers
 * false: it has no moderation queue to show.
 */
export function useIsInstanceOperator() {
  const userId = useAuthStore((s) => s.session?.userId);
  const query = useQuery({
    queryKey: queryKeys.instanceOperator(userId),
    enabled: userId !== undefined,
    staleTime: 300_000,
    retry: false,
    queryFn: async () => {
      try {
        const res = await graphqlClient.request<{
          me: { id: string; instanceOperator: boolean };
        }>(INSTANCE_OPERATOR);
        return res.me.instanceOperator;
      } catch (err) {
        if (isSchemaRefusal(err)) return false;
        throw err;
      }
    },
  });
  return {
    isOperator: query.data === true,
    isPending: userId !== undefined && query.isPending,
    error: query.error,
  };
}

/** Abuse reports, oldest first; only the open ones unless `openOnly` is false. */
export function useInstanceReports(openOnly: boolean) {
  return useQuery({
    queryKey: queryKeys.instanceReports(openOnly),
    retry: false,
    queryFn: async () => {
      const res = await graphqlClient.request<{ instanceReports: InstanceAbuseReport[] }>(
        INSTANCE_REPORTS,
        { openOnly },
      );
      return res.instanceReports;
    },
  });
}

/** Principals this server refuses, newest first. */
export function useInstancePrincipalBlocks() {
  return useQuery({
    queryKey: queryKeys.instancePrincipalBlocks,
    retry: false,
    queryFn: async () => {
      const res = await graphqlClient.request<{
        instancePrincipalBlocks: InstancePrincipalBlock[];
      }>(INSTANCE_PRINCIPAL_BLOCKS);
      return res.instancePrincipalBlocks;
    },
  });
}

/** The IP deny list, oldest first, expired blocks included. */
export function useInstanceIpBlocks() {
  return useQuery({
    queryKey: queryKeys.instanceIpBlocks,
    retry: false,
    queryFn: async () => {
      const res = await graphqlClient.request<{ instanceIpBlocks: InstanceIpBlock[] }>(
        INSTANCE_IP_BLOCKS,
      );
      return res.instanceIpBlocks;
    },
  });
}

/**
 * Refreshes `keys` after a change, and re-asks whether the viewer is an operator when the server
 * refused one with `FORBIDDEN`.
 */
function useModerationMutationEffects(keys: readonly (readonly unknown[])[]) {
  const qc = useQueryClient();
  return {
    onSuccess: () => {
      for (const queryKey of keys) qc.invalidateQueries({ queryKey });
    },
    onError: (err: unknown) => {
      if (isOperatorRefusal(err)) qc.invalidateQueries({ queryKey: ["me", "instanceOperator"] });
    },
  };
}

const REPORTS_ROOT = ["instanceModeration", "reports"] as const;

export function useResolveInstanceReportMutation() {
  const effects = useModerationMutationEffects([REPORTS_ROOT]);
  return useMutation({
    mutationFn: (vars: MutationInstanceResolveReportArgs) =>
      graphqlClient.request<{ instanceResolveReport: InstanceAbuseReport }>(RESOLVE_REPORT, vars),
    ...effects,
  });
}

/** Blocks a principal; one outcome per account blocked, the principal's first. */
export function useBlockPrincipalMutation() {
  const effects = useModerationMutationEffects([queryKeys.instancePrincipalBlocks]);
  return useMutation({
    mutationFn: async (vars: MutationInstanceBlockPrincipalArgs) => {
      const res = await graphqlClient.request<{
        instanceBlockPrincipal: InstancePrincipalBlockOutcome[];
      }>(BLOCK_PRINCIPAL, vars);
      return res.instanceBlockPrincipal;
    },
    ...effects,
  });
}

export function useUnblockPrincipalMutation() {
  const effects = useModerationMutationEffects([queryKeys.instancePrincipalBlocks]);
  return useMutation({
    mutationFn: async (vars: MutationInstanceUnblockPrincipalArgs) => {
      const res = await graphqlClient.request<{
        instanceUnblockPrincipal: InstancePrincipalUnblockOutcome;
      }>(UNBLOCK_PRINCIPAL, vars);
      return res.instanceUnblockPrincipal;
    },
    ...effects,
  });
}

export function useBlockIpMutation() {
  const effects = useModerationMutationEffects([queryKeys.instanceIpBlocks]);
  return useMutation({
    mutationFn: async (vars: MutationInstanceBlockIpArgs) => {
      const res = await graphqlClient.request<{ instanceBlockIp: InstanceIpBlockOutcome }>(
        BLOCK_IP,
        vars,
      );
      return res.instanceBlockIp;
    },
    ...effects,
  });
}

export function useUnblockIpMutation() {
  const effects = useModerationMutationEffects([queryKeys.instanceIpBlocks]);
  return useMutation({
    mutationFn: async (vars: MutationInstanceUnblockIpArgs) => {
      const res = await graphqlClient.request<{ instanceUnblockIp: boolean }>(UNBLOCK_IP, vars);
      return res.instanceUnblockIp;
    },
    ...effects,
  });
}
