import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import type {
  PipelineGql,
  CreatePipelineInput,
  UpdatePipelineInput,
  PipelineTriggerKindGql,
} from "../../../core/graphql/generated/schema-types";

export type { CreatePipelineInput, UpdatePipelineInput, PipelineTriggerKindGql };

/** Output-side pipeline type for list/detail views. */
export type Pipeline = PipelineGql;

const PIPELINE_FIELDS = `
  id
  serverId
  name
  description
  trigger {
    kind
    conversationId
  }
  filter {
    conditions {
      conditionType
      pattern
      userId
      conversationId
    }
  }
  actions {
    actionType
    commandId
    args
  }
  enabled
  cooldownSecs
  createdBy
  schemaVersion
  lastFiredAt
  createdAt
  updatedAt
`;

const PipelinesDocument = gql`
  query Pipelines($serverId: ID!, $enabled: Boolean) {
    pipelines(serverId: $serverId, enabled: $enabled) {
      ${PIPELINE_FIELDS}
    }
  }
`;

const CreatePipelineDocument = gql`
  mutation CreatePipeline($input: CreatePipelineInput!) {
    createPipeline(input: $input) {
      ${PIPELINE_FIELDS}
    }
  }
`;

const UpdatePipelineDocument = gql`
  mutation UpdatePipeline($input: UpdatePipelineInput!) {
    updatePipeline(input: $input) {
      ${PIPELINE_FIELDS}
    }
  }
`;

const DeletePipelineDocument = gql`
  mutation DeletePipeline($pipelineId: ID!) {
    deletePipeline(pipelineId: $pipelineId)
  }
`;

const TogglePipelineDocument = gql`
  mutation TogglePipeline($pipelineId: ID!, $enabled: Boolean!) {
    togglePipeline(pipelineId: $pipelineId, enabled: $enabled) {
      ${PIPELINE_FIELDS}
    }
  }
`;

export function usePipelines(serverId?: string) {
  return useQuery({
    queryKey: queryKeys.pipelines(serverId),
    enabled: Boolean(serverId),
    staleTime: 30_000,
    queryFn: async () => {
      const res = await graphqlClient.request<{ pipelines: Pipeline[] }>(PipelinesDocument, {
        serverId,
      });
      return res.pipelines;
    },
  });
}

export function useCreatePipelineMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePipelineInput) =>
      graphqlClient.request<{ createPipeline: Pipeline }>(CreatePipelineDocument, { input }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.pipelines(vars.serverId) });
    },
  });
}

export function useUpdatePipelineMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdatePipelineInput) =>
      graphqlClient.request<{ updatePipeline: Pipeline }>(UpdatePipelineDocument, { input }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: queryKeys.pipelines(data.updatePipeline.serverId) });
    },
  });
}

export function useDeletePipelineMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { pipelineId: string; serverId: string }) =>
      graphqlClient.request(DeletePipelineDocument, { pipelineId: vars.pipelineId }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.pipelines(vars.serverId) });
    },
  });
}

export function useTogglePipelineMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { pipelineId: string; enabled: boolean; serverId: string }) =>
      graphqlClient.request<{ togglePipeline: Pipeline }>(TogglePipelineDocument, {
        pipelineId: vars.pipelineId,
        enabled: vars.enabled,
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.pipelines(vars.serverId) });
    },
  });
}
