import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import type {
  EscalationPolicyGql,
  EscalationStepInputGql,
} from "../../../core/graphql/generated/schema-types";

export type EscalationPolicy = EscalationPolicyGql;

const ESCALATION_POLICY_FIELDS = gql`
  fragment EscalationPolicyFields on EscalationPolicyGql {
    id
    serverId
    name
    createdBy
    createdAt
    updatedAt
    steps {
      id
      policyId
      position
      delaySeconds
      targetKind
      targetUserId
      targetScheduleId
      actions
    }
  }
`;

const ESCALATION_POLICIES_QUERY = gql`
  query EscalationPolicies($serverId: ID!) {
    escalationPolicies(serverId: $serverId) {
      ...EscalationPolicyFields
    }
  }
  ${ESCALATION_POLICY_FIELDS}
`;

/** Lists a server's escalation policies (Track C1). Any workspace member may read. */
export function useEscalationPolicies(serverId?: string) {
  return useQuery({
    queryKey: queryKeys.escalationPolicies(serverId),
    enabled: Boolean(serverId),
    staleTime: 30_000,
    queryFn: async () => {
      const res = await graphqlClient.request<{ escalationPolicies: EscalationPolicy[] }>(
        ESCALATION_POLICIES_QUERY,
        { serverId: serverId! },
      );
      return res.escalationPolicies;
    },
  });
}

const CREATE_ESCALATION_POLICY_MUTATION = gql`
  mutation CreateEscalationPolicy(
    $serverId: ID!
    $name: String!
    $steps: [EscalationStepInputGql!]!
  ) {
    createEscalationPolicy(serverId: $serverId, name: $name, steps: $steps) {
      ...EscalationPolicyFields
    }
  }
  ${ESCALATION_POLICY_FIELDS}
`;

export interface CreateEscalationPolicyVars {
  serverId: string;
  name: string;
  steps: EscalationStepInputGql[];
}

/** Creates an escalation policy. Owner/Moderator-gated on the backend (server-scoped). */
export function useCreateEscalationPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: CreateEscalationPolicyVars) =>
      graphqlClient
        .request<{ createEscalationPolicy: EscalationPolicy }>(
          CREATE_ESCALATION_POLICY_MUTATION,
          vars,
        )
        .then((res) => res.createEscalationPolicy),
    onSuccess: (_result, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.escalationPolicies(vars.serverId) });
    },
  });
}

const UPDATE_ESCALATION_POLICY_MUTATION = gql`
  mutation UpdateEscalationPolicy(
    $policyId: ID!
    $name: String
    $steps: [EscalationStepInputGql!]
  ) {
    updateEscalationPolicy(policyId: $policyId, name: $name, steps: $steps) {
      ...EscalationPolicyFields
    }
  }
  ${ESCALATION_POLICY_FIELDS}
`;

export interface UpdateEscalationPolicyVars {
  serverId: string;
  policyId: string;
  name?: string;
  steps?: EscalationStepInputGql[];
}

/** Updates a policy's name and/or full step list (`steps` replaces the list atomically). */
export function useUpdateEscalationPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: UpdateEscalationPolicyVars) =>
      graphqlClient
        .request<{ updateEscalationPolicy: EscalationPolicy }>(UPDATE_ESCALATION_POLICY_MUTATION, {
          policyId: vars.policyId,
          name: vars.name,
          steps: vars.steps,
        })
        .then((res) => res.updateEscalationPolicy),
    onSuccess: (_result, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.escalationPolicies(vars.serverId) });
    },
  });
}

const DELETE_ESCALATION_POLICY_MUTATION = gql`
  mutation DeleteEscalationPolicy($policyId: ID!) {
    deleteEscalationPolicy(policyId: $policyId)
  }
`;

export function useDeleteEscalationPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { serverId: string; policyId: string }) =>
      graphqlClient.request<{ deleteEscalationPolicy: boolean }>(
        DELETE_ESCALATION_POLICY_MUTATION,
        { policyId: vars.policyId },
      ),
    onSuccess: (_result, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.escalationPolicies(vars.serverId) });
    },
  });
}

const SET_CHANNEL_ESCALATION_POLICY_MUTATION = gql`
  mutation SetChannelEscalationPolicy($serverId: ID!, $conversationId: ID!, $policyId: ID!) {
    setChannelEscalationPolicy(
      serverId: $serverId
      conversationId: $conversationId
      policyId: $policyId
    )
  }
`;

/**
 * Sets a channel's default escalation policy. **Note:** there is no query to read a
 * channel's *current* escalation-policy binding today, so the "Channel default policies"
 * UI can only set new bindings — it cannot list or confirm existing ones. See
 * `docs/oncall-ui.md`.
 */
export function useSetChannelEscalationPolicy() {
  return useMutation({
    mutationFn: (vars: { serverId: string; conversationId: string; policyId: string }) =>
      graphqlClient.request<{ setChannelEscalationPolicy: boolean }>(
        SET_CHANNEL_ESCALATION_POLICY_MUTATION,
        vars,
      ),
  });
}
