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
    }
  }
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

export function useActiveIncident(serverId: string | null, conversationId: string | null) {
  return useQuery({
    queryKey: queryKeys.activeIncident(serverId ?? undefined, conversationId ?? undefined),
    enabled: Boolean(serverId && conversationId),
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
