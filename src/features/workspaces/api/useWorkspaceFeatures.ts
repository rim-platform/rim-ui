import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import { queryClient } from "../../../core/query/queryClient";
import type {
  Mutation,
  MutationSetWorkspaceFeatureArgs,
  Query,
  QueryWorkspaceFeaturesArgs,
  WorkspaceFeature,
  WorkspaceFeatureState,
} from "../../../core/graphql/generated/schema-types";

const WORKSPACE_FEATURES_QUERY = gql`
  query WorkspaceFeatures($serverId: ID!) {
    workspaceFeatures(serverId: $serverId) {
      feature
      enabled
      updatedAt
    }
  }
`;

const SET_WORKSPACE_FEATURE_MUTATION = gql`
  mutation SetWorkspaceFeature($serverId: ID!, $feature: WorkspaceFeature!, $enabled: Boolean!) {
    setWorkspaceFeature(serverId: $serverId, feature: $feature, enabled: $enabled) {
      feature
      enabled
      updatedAt
    }
  }
`;

type WorkspaceFeaturesResponse = Pick<Query, "workspaceFeatures">;
type SetWorkspaceFeatureResponse = Pick<Mutation, "setWorkspaceFeature">;

/**
 * The optional modules of one workspace and whether each is on (Track 0.4). Any member may
 * read; the server fills in defaults, so every known feature has an entry.
 */
export function useWorkspaceFeatures(serverId?: string | null) {
  return useQuery({
    queryKey: queryKeys.workspaceFeatures(serverId ?? undefined),
    enabled: Boolean(serverId),
    staleTime: 60_000,
    queryFn: async () => {
      const variables: QueryWorkspaceFeaturesArgs = { serverId: serverId! };
      const res = await graphqlClient.request<WorkspaceFeaturesResponse>(
        WORKSPACE_FEATURES_QUERY,
        variables,
      );
      return res.workspaceFeatures;
    },
  });
}

/**
 * Turn a workspace feature on or off. Owner-only server-side (moderators get `FORBIDDEN`);
 * nothing is deleted when a feature is turned off.
 *
 * On success the features query, `myServers` and the command lists are refreshed — the
 * server filters gated commands out of `commands`, so the palette changes with the flag.
 */
export function useSetWorkspaceFeature() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (variables: MutationSetWorkspaceFeatureArgs) => {
      const res = await graphqlClient.request<SetWorkspaceFeatureResponse>(
        SET_WORKSPACE_FEATURE_MUTATION,
        variables,
      );
      return res.setWorkspaceFeature;
    },
    onSuccess: (state, variables) => {
      const key = queryKeys.workspaceFeatures(variables.serverId);
      // Apply the returned state right away so gated UI follows the toggle without waiting
      // for the refetch below.
      qc.setQueryData<WorkspaceFeatureState[]>(key, (prev) =>
        prev?.map((entry) => (entry.feature === state.feature ? state : entry)),
      );
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: queryKeys.myServers() });
      qc.invalidateQueries({ queryKey: ["commands"] });
    },
  });
}

/**
 * Non-hook read of a feature flag from the shared query cache, for imperative callers such as
 * the command dispatcher. Returns `undefined` when the workspace's features are not cached
 * yet, so callers can defer to the server instead of guessing.
 */
export function getCachedFeatureEnabled(
  serverId: string,
  feature: WorkspaceFeature,
): boolean | undefined {
  const features = queryClient.getQueryData<WorkspaceFeatureState[]>(
    queryKeys.workspaceFeatures(serverId),
  );
  if (!features) return undefined;
  return features.some((entry) => entry.feature === feature && entry.enabled);
}
