import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import { MESSAGE_WITH_REACTIONS } from "../../../graphql/fragments/message";
import type { MessageItem } from "../../../core/types/messages";
import {
  FilterField,
  FilterOp,
  FilterLogic,
  type FilterConditionGql,
  type FilterSpecGql,
  type ChannelLens,
} from "../../../core/graphql/generated/schema-types";

// --- Re-exports for backward compatibility ---

export { FilterField, FilterOp, FilterLogic };
export type { ChannelLens };
export type FilterCondition = FilterConditionGql;
export type FilterSpec = FilterSpecGql;

// --- Queries ---

const CHANNEL_LENSES_QUERY = gql`
  query ChannelLenses($serverId: ID!, $conversationId: ID!) {
    channelLenses(serverId: $serverId, conversationId: $conversationId) {
      id
      serverId
      conversationId
      createdBy
      name
      filterSpec {
        conditions {
          field
          op
          value
        }
        logic
      }
      isShared
      createdAt
      updatedAt
    }
  }
`;

const APPLY_LENS_QUERY = gql`
  query ApplyChannelLens($serverId: ID!, $conversationId: ID!, $lensId: ID!, $limit: Int! = 50) {
    applyChannelLens(serverId: $serverId, conversationId: $conversationId, lensId: $lensId, limit: $limit) {
      ...MessageWithReactions
    }
  }
  ${MESSAGE_WITH_REACTIONS}
`;

// --- Mutations ---

const CREATE_LENS_MUTATION = gql`
  mutation CreateChannelLens($input: CreateChannelLensInput!) {
    createChannelLens(input: $input) {
      id
      serverId
      conversationId
      createdBy
      name
      filterSpec {
        conditions {
          field
          op
          value
        }
        logic
      }
      isShared
      createdAt
      updatedAt
    }
  }
`;

const UPDATE_LENS_MUTATION = gql`
  mutation UpdateChannelLens($input: UpdateChannelLensInput!) {
    updateChannelLens(input: $input) {
      id
      serverId
      conversationId
      createdBy
      name
      filterSpec {
        conditions {
          field
          op
          value
        }
        logic
      }
      isShared
      createdAt
      updatedAt
    }
  }
`;

const DELETE_LENS_MUTATION = gql`
  mutation DeleteChannelLens($serverId: ID!, $lensId: ID!) {
    deleteChannelLens(serverId: $serverId, lensId: $lensId)
  }
`;

// --- Response types ---

interface ChannelLensesResponse {
  channelLenses: ChannelLens[];
}

interface ApplyLensResponse {
  applyChannelLens: MessageItem[];
}

interface CreateLensResponse {
  createChannelLens: ChannelLens;
}

interface UpdateLensResponse {
  updateChannelLens: ChannelLens;
}

// --- Hooks ---

export function useLenses(serverId?: string, conversationId?: string) {
  return useQuery({
    queryKey: queryKeys.lenses(serverId, conversationId),
    enabled: Boolean(serverId && conversationId),
    staleTime: 30_000,
    queryFn: async () => {
      const res = await graphqlClient.request<ChannelLensesResponse>(CHANNEL_LENSES_QUERY, {
        serverId: serverId!,
        conversationId: conversationId!,
      });
      return res.channelLenses;
    },
  });
}

export function useApplyLens(serverId?: string, conversationId?: string, lensId?: string | null) {
  return useQuery({
    queryKey: queryKeys.lensMessages(serverId, conversationId, lensId ?? undefined),
    enabled: Boolean(serverId && conversationId && lensId),
    staleTime: 10_000,
    queryFn: async () => {
      const res = await graphqlClient.request<ApplyLensResponse>(APPLY_LENS_QUERY, {
        serverId: serverId!,
        conversationId: conversationId!,
        lensId: lensId!,
        limit: 50,
      });
      return { items: res.applyChannelLens };
    },
  });
}

export function useCreateLensMutation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (vars: {
      serverId: string;
      conversationId: string;
      name: string;
      filterSpec: FilterSpec;
      isShared: boolean;
    }) =>
      graphqlClient.request<CreateLensResponse>(CREATE_LENS_MUTATION, {
        input: {
          serverId: vars.serverId,
          conversationId: vars.conversationId,
          name: vars.name,
          filterSpec: vars.filterSpec,
          isShared: vars.isShared,
        },
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.lenses(vars.serverId, vars.conversationId) });
    },
  });
}

export function useUpdateLensMutation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (vars: {
      lensId: string;
      serverId: string;
      conversationId: string;
      name: string;
      filterSpec: FilterSpec;
      isShared: boolean;
    }) =>
      graphqlClient.request<UpdateLensResponse>(UPDATE_LENS_MUTATION, {
        input: {
          serverId: vars.serverId,
          lensId: vars.lensId,
          name: vars.name,
          filterSpec: vars.filterSpec,
          isShared: vars.isShared,
        },
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.lenses(vars.serverId, vars.conversationId) });
      qc.invalidateQueries({ queryKey: queryKeys.lensMessages(vars.serverId, vars.conversationId, vars.lensId) });
    },
  });
}

export function useDeleteLensMutation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (vars: { lensId: string; serverId: string; conversationId: string }) =>
      graphqlClient.request(DELETE_LENS_MUTATION, { serverId: vars.serverId, lensId: vars.lensId }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.lenses(vars.serverId, vars.conversationId) });
    },
  });
}
