import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import type {
  IncidentSeverityGql,
  IncidentStatusGql,
  IncidentPhaseNameGql,
  MessageTagTypeGql,
  IncidentGql,
  IncidentPhaseGql,
  IncidentMessageTagGql,
  IncidentTimelineGql,
} from "../../../core/graphql/generated/schema-types";

// --- Re-exports for backward compatibility ---

export type IncidentSeverity = IncidentSeverityGql;
export type IncidentStatus = IncidentStatusGql;
export type IncidentPhaseName = IncidentPhaseNameGql;
export type MessageTagType = MessageTagTypeGql;
export type Incident = IncidentGql;
export type IncidentPhase = IncidentPhaseGql;
export type IncidentMessageTag = IncidentMessageTagGql;
export type IncidentTimeline = IncidentTimelineGql;

// --- Queries ---

// Ack/escalation fields (Track C1c) shared by both queries below — `acknowledgedByUser`
// resolves via the shared `User` DataLoader, and `escalationRun` is a pure read
// projection of the active `escalation_run` row (nullable — see the schema doc comment
// on `IncidentGql.escalationRun` for when it's absent).
const INCIDENT_ACK_ESCALATION_FIELDS = gql`
  fragment IncidentAckEscalationFields on IncidentGql {
    escalationPolicyId
    acknowledgedAt
    acknowledgedBy
    acknowledgedByUser {
      id
      username
      displayName
      avatarUrl
    }
    escalationRun {
      currentStepIndex
      nextFireAt
      status
    }
  }
`;

const ACTIVE_INCIDENT = gql`
  query ActiveIncident($serverId: ID!, $conversationId: ID!) {
    activeIncident(serverId: $serverId, conversationId: $conversationId) {
      id
      serverId
      conversationId
      startedBy
      status
      severity
      title
      originalTopic
      startedAt
      mitigatedAt
      resolvedAt
      postmortemDraft
      ...IncidentAckEscalationFields
    }
  }
  ${INCIDENT_ACK_ESCALATION_FIELDS}
`;

const INCIDENT_TIMELINE = gql`
  query IncidentTimeline($incidentId: ID!) {
    incidentTimeline(incidentId: $incidentId) {
      incident {
        id
        serverId
        conversationId
        startedBy
        status
        severity
        title
        originalTopic
        startedAt
        mitigatedAt
        resolvedAt
        postmortemDraft
        ...IncidentAckEscalationFields
      }
      phases {
        id
        incidentId
        phase
        startedAt
        endedAt
        note
      }
      taggedMessages {
        messageId
        incidentId
        phase
        tagType
      }
    }
  }
  ${INCIDENT_ACK_ESCALATION_FIELDS}
`;

// --- Mutations ---

const START_INCIDENT = gql`
  mutation StartIncident($input: StartIncidentInput!) {
    startIncident(input: $input) {
      id
      serverId
      conversationId
      startedBy
      status
      severity
      title
      originalTopic
      startedAt
      mitigatedAt
      resolvedAt
      postmortemDraft
    }
  }
`;

const UPDATE_INCIDENT_STATUS = gql`
  mutation UpdateIncidentStatus($input: UpdateIncidentStatusInput!) {
    updateIncidentStatus(input: $input) {
      id
      status
      mitigatedAt
      resolvedAt
    }
  }
`;

const ADVANCE_INCIDENT_PHASE = gql`
  mutation AdvanceIncidentPhase($input: AdvanceIncidentPhaseInput!) {
    advanceIncidentPhase(input: $input) {
      id
      status
    }
  }
`;

const TAG_INCIDENT_MESSAGE = gql`
  mutation TagIncidentMessage($input: TagIncidentMessageInput!) {
    tagIncidentMessage(input: $input) {
      messageId
      incidentId
      phase
      tagType
    }
  }
`;

const GENERATE_POSTMORTEM = gql`
  mutation GeneratePostmortem($incidentId: ID!) {
    generatePostmortem(incidentId: $incidentId) {
      id
      postmortemDraft
    }
  }
`;

const RESOLVE_INCIDENT = gql`
  mutation ResolveIncident($incidentId: ID!) {
    resolveIncident(incidentId: $incidentId) {
      id
      status
      resolvedAt
    }
  }
`;

// --- Query Hooks ---

/**
 * The open incident in a conversation, or `null`. Pass `enabled: false` to skip the request
 * entirely — e.g. when the workspace's incidents feature is off (Track 0.4).
 */
export function useActiveIncident(
  serverId: string | null,
  conversationId: string | null,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: queryKeys.activeIncident(serverId ?? undefined, conversationId ?? undefined),
    enabled: (options?.enabled ?? true) && Boolean(serverId && conversationId),
    staleTime: 10_000,
    queryFn: async () => {
      const res = await graphqlClient.request<{ activeIncident: Incident | null }>(
        ACTIVE_INCIDENT,
        { serverId: serverId!, conversationId: conversationId! },
      );
      return res.activeIncident;
    },
  });
}

export function useIncidentTimeline(incidentId: string | null) {
  return useQuery({
    queryKey: queryKeys.incidentTimeline(incidentId ?? undefined),
    enabled: Boolean(incidentId),
    staleTime: 5_000,
    queryFn: async () => {
      const res = await graphqlClient.request<{ incidentTimeline: IncidentTimeline }>(
        INCIDENT_TIMELINE,
        { incidentId: incidentId! },
      );
      return res.incidentTimeline;
    },
  });
}

// --- Mutation Hooks ---

interface StartIncidentVars {
  serverId: string;
  conversationId: string;
  title: string;
  severity: IncidentSeverity;
}

export function useStartIncident() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: StartIncidentVars) =>
      graphqlClient.request<{ startIncident: Incident }>(START_INCIDENT, {
        input: vars,
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: queryKeys.activeIncident(vars.serverId, vars.conversationId),
      });
    },
  });
}

interface UpdateIncidentStatusVars {
  incidentId: string;
  status: IncidentStatus;
  serverId: string;
  conversationId: string;
}

export function useUpdateIncidentStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: UpdateIncidentStatusVars) =>
      graphqlClient.request(UPDATE_INCIDENT_STATUS, {
        input: { incidentId: vars.incidentId, status: vars.status },
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: queryKeys.activeIncident(vars.serverId, vars.conversationId),
      });
      qc.invalidateQueries({
        queryKey: queryKeys.incidentTimeline(vars.incidentId),
      });
    },
  });
}

interface AdvancePhaseVars {
  incidentId: string;
  nextPhase: IncidentPhaseName;
  note: string;
  serverId: string;
  conversationId: string;
}

export function useAdvancePhase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: AdvancePhaseVars) =>
      graphqlClient.request(ADVANCE_INCIDENT_PHASE, {
        input: { incidentId: vars.incidentId, nextPhase: vars.nextPhase, note: vars.note },
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: queryKeys.activeIncident(vars.serverId, vars.conversationId),
      });
      qc.invalidateQueries({
        queryKey: queryKeys.incidentTimeline(vars.incidentId),
      });
    },
  });
}

interface TagMessageVars {
  incidentId: string;
  messageId: string;
  phase: IncidentPhaseName;
  tagType: MessageTagType;
}

export function useTagMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: TagMessageVars) =>
      graphqlClient.request(TAG_INCIDENT_MESSAGE, {
        input: vars,
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: queryKeys.incidentTimeline(vars.incidentId),
      });
    },
  });
}

interface GeneratePostmortemVars {
  incidentId: string;
  serverId: string;
  conversationId: string;
}

export function useGeneratePostmortem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: GeneratePostmortemVars) =>
      graphqlClient.request(GENERATE_POSTMORTEM, {
        incidentId: vars.incidentId,
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: queryKeys.activeIncident(vars.serverId, vars.conversationId),
      });
    },
  });
}

interface ResolveIncidentVars {
  incidentId: string;
  serverId: string;
  conversationId: string;
}

export function useResolveIncident() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: ResolveIncidentVars) =>
      graphqlClient.request(RESOLVE_INCIDENT, {
        incidentId: vars.incidentId,
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: queryKeys.activeIncident(vars.serverId, vars.conversationId),
      });
      qc.invalidateQueries({
        queryKey: queryKeys.incidentTimeline(vars.incidentId),
      });
    },
  });
}

const ACKNOWLEDGE_INCIDENT = gql`
  mutation AcknowledgeIncident($incidentId: ID!) {
    acknowledgeIncident(incidentId: $incidentId) {
      id
      acknowledgedAt
      acknowledgedBy
      acknowledgedByUser {
        id
        username
        displayName
        avatarUrl
      }
    }
  }
`;

interface AcknowledgeIncidentVars {
  incidentId: string;
  serverId: string;
  conversationId: string;
}

/**
 * Direct `acknowledgeIncident` mutation (any member, idempotent). Kept for API-surface
 * completeness (other CRUD hooks in this module follow the same shape), but **the C1 human
 * ack surfaces (banner button, paged toast, keybind) deliberately do NOT use this hook** —
 * per the C1c ack-tier resolution, they dispatch through the unified `incident.ack` command
 * (`executeCommand`) instead, so ack behaves identically everywhere and stays consistent
 * with `oncall.who`/`oncall.take_shift`/`incident.escalate`. See `IncidentBanner.tsx` and
 * `commandDispatcher.ts`.
 */
export function useAcknowledgeIncident() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: AcknowledgeIncidentVars) =>
      graphqlClient.request<{ acknowledgeIncident: Incident }>(ACKNOWLEDGE_INCIDENT, {
        incidentId: vars.incidentId,
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: queryKeys.activeIncident(vars.serverId, vars.conversationId),
      });
      qc.invalidateQueries({
        queryKey: queryKeys.incidentTimeline(vars.incidentId),
      });
    },
  });
}
