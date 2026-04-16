import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import {
  WorkspaceStateScopeGql,
  type WorkspaceStateEntryGql,
  type SetWorkspaceStateInput,
  type DeleteWorkspaceStateInput,
  type IncrementWorkspaceStateInput,
} from "../../../core/graphql/generated/schema-types";

// --- Re-exports for convenience ---

export type { WorkspaceStateEntryGql, SetWorkspaceStateInput, DeleteWorkspaceStateInput, IncrementWorkspaceStateInput };
export { WorkspaceStateScopeGql } from "../../../core/graphql/generated/schema-types";

// --- Documents ---

const WorkspaceStateDocument = gql`
  query WorkspaceState($serverId: ID!, $key: String!, $scope: WorkspaceStateScopeGql!) {
    workspaceState(serverId: $serverId, key: $key, scope: $scope) {
      id
      serverId
      key
      value
      scope
      userId
      version
      expiresAt
      createdAt
      updatedAt
    }
  }
`;

const WorkspaceStateListDocument = gql`
  query WorkspaceStateList($serverId: ID!, $prefix: String!, $scope: WorkspaceStateScopeGql!, $limit: Int) {
    workspaceStateList(serverId: $serverId, prefix: $prefix, scope: $scope, limit: $limit) {
      id
      serverId
      key
      value
      scope
      userId
      version
      expiresAt
      createdAt
      updatedAt
    }
  }
`;

const SetWorkspaceStateDocument = gql`
  mutation SetWorkspaceState($input: SetWorkspaceStateInput!) {
    setWorkspaceState(input: $input) {
      id
      serverId
      key
      value
      scope
      userId
      version
      expiresAt
      createdAt
      updatedAt
    }
  }
`;

const DeleteWorkspaceStateDocument = gql`
  mutation DeleteWorkspaceState($input: DeleteWorkspaceStateInput!) {
    deleteWorkspaceState(input: $input)
  }
`;

const IncrementWorkspaceStateDocument = gql`
  mutation IncrementWorkspaceState($input: IncrementWorkspaceStateInput!) {
    incrementWorkspaceState(input: $input) {
      id
      serverId
      key
      value
      scope
      userId
      version
      expiresAt
      createdAt
      updatedAt
    }
  }
`;

// --- Response types ---

interface WorkspaceStateResponse {
  workspaceState: WorkspaceStateEntryGql | null;
}

interface WorkspaceStateListResponse {
  workspaceStateList: WorkspaceStateEntryGql[];
}

interface SetWorkspaceStateResponse {
  setWorkspaceState: WorkspaceStateEntryGql;
}

interface IncrementWorkspaceStateResponse {
  incrementWorkspaceState: WorkspaceStateEntryGql;
}

// --- Hooks ---

export function useWorkspaceState(
  serverId: string | undefined,
  key: string | undefined,
  scope?: WorkspaceStateScopeGql,
) {
  const resolvedScope = scope ?? WorkspaceStateScopeGql.SERVER;

  return useQuery({
    queryKey: queryKeys.workspaceState(serverId, resolvedScope, key),
    enabled: Boolean(serverId && key),
    staleTime: 10_000,
    queryFn: async () => {
      const res = await graphqlClient.request<WorkspaceStateResponse>(
        WorkspaceStateDocument,
        { serverId: serverId!, key: key!, scope: resolvedScope },
      );
      return res.workspaceState;
    },
  });
}

export function useWorkspaceStateList(
  serverId: string | undefined,
  prefix: string,
  scope?: WorkspaceStateScopeGql,
  limit?: number,
) {
  const resolvedScope = scope ?? WorkspaceStateScopeGql.SERVER;

  return useQuery({
    queryKey: queryKeys.workspaceStateList(serverId, resolvedScope, prefix),
    enabled: Boolean(serverId),
    staleTime: 10_000,
    queryFn: async () => {
      const res = await graphqlClient.request<WorkspaceStateListResponse>(
        WorkspaceStateListDocument,
        { serverId: serverId!, prefix, scope: resolvedScope, limit: limit ?? null },
      );
      return res.workspaceStateList;
    },
  });
}

export function useSetWorkspaceState() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (input: SetWorkspaceStateInput) =>
      graphqlClient.request<SetWorkspaceStateResponse>(SetWorkspaceStateDocument, { input }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: queryKeys.workspaceState(vars.serverId, vars.scope, vars.key),
      });
      qc.invalidateQueries({
        queryKey: queryKeys.workspaceStateList(vars.serverId, vars.scope),
      });
    },
  });
}

export function useDeleteWorkspaceState() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (input: DeleteWorkspaceStateInput) =>
      graphqlClient.request(DeleteWorkspaceStateDocument, { input }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: queryKeys.workspaceState(vars.serverId, vars.scope, vars.key),
      });
      qc.invalidateQueries({
        queryKey: queryKeys.workspaceStateList(vars.serverId, vars.scope),
      });
    },
  });
}

export function useIncrementWorkspaceState() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (input: IncrementWorkspaceStateInput) =>
      graphqlClient.request<IncrementWorkspaceStateResponse>(
        IncrementWorkspaceStateDocument,
        { input },
      ),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: queryKeys.workspaceState(vars.serverId, vars.scope, vars.key),
      });
      qc.invalidateQueries({
        queryKey: queryKeys.workspaceStateList(vars.serverId, vars.scope),
      });
    },
  });
}
