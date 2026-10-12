// A workspace's plugin registry on its server: the entries, the three mutations, and bundle
// uploads to the server's own copy.

import { useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { getCookie, graphqlClient } from "../../../core/graphql/client";
import { getApiOrigin } from "../../../core/graphql/config";
import type {
  AddWorkspacePluginInput,
  UpdateWorkspacePluginInput,
  User,
  WorkspacePlugin,
} from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { featureDisabledFromResponse } from "../../../core/serverFeatures";
import { useIsDirectSpace } from "../../relay/state/useRelayStore";
import { BUNDLE_MEDIA_TYPE } from "../web/bundle";

/** One registry entry as this client selects it. */
export type RegistryEntry = Omit<WorkspacePlugin, "approvedBy"> & {
  approvedBy?: Pick<User, "id" | "username" | "displayName" | "principalId"> | null;
};

const ENTRY_FIELDS = `
  id serverId pluginId version displayName runtimeKind status
  source { kind bundleUrl bundleSha256 bundleSize gitUrl gitCommit gitTreeSha256 }
  manifest statement { payload signature }
  publisherPrincipalId publisherName publisherKeySeq publisherKeyLog { payload signature }
  signatureStatus approvedBy { id username displayName principalId } approvedAt updatedAt
`;

const WORKSPACE_PLUGINS_QUERY = gql`
  query WorkspacePlugins($serverId: ID!) {
    workspacePlugins(serverId: $serverId) { ${ENTRY_FIELDS} }
  }
`;

const ADD_MUTATION = gql`
  mutation AddWorkspacePlugin($input: AddWorkspacePluginInput!) {
    addWorkspacePlugin(input: $input) { ${ENTRY_FIELDS} }
  }
`;

const UPDATE_MUTATION = gql`
  mutation UpdateWorkspacePlugin($input: UpdateWorkspacePluginInput!) {
    updateWorkspacePlugin(input: $input) { ${ENTRY_FIELDS} }
  }
`;

const REMOVE_MUTATION = gql`
  mutation RemoveWorkspacePlugin($serverId: ID!, $pluginId: String!) {
    removeWorkspacePlugin(serverId: $serverId, pluginId: $pluginId)
  }
`;

export async function fetchWorkspacePlugins(serverId: string): Promise<RegistryEntry[]> {
  const res = await graphqlClient.request<{ workspacePlugins: RegistryEntry[] }>(
    WORKSPACE_PLUGINS_QUERY,
    { serverId },
  );
  return res.workspacePlugins;
}

/**
 * The registry of `serverId`, refetched when a `WorkspacePluginChanged` event arrives. Not
 * fetched in a direct space, which has no registry.
 */
export function useWorkspacePlugins(serverId: string | null | undefined, enabled = true) {
  const direct = useIsDirectSpace(serverId);
  return useQuery({
    queryKey: queryKeys.workspacePlugins(serverId),
    enabled: Boolean(serverId) && enabled && !direct,
    staleTime: 60_000,
    queryFn: () => fetchWorkspacePlugins(serverId as string),
  });
}

export async function addWorkspacePlugin(input: AddWorkspacePluginInput): Promise<RegistryEntry> {
  const res = await graphqlClient.request<{ addWorkspacePlugin: RegistryEntry }>(ADD_MUTATION, {
    input,
  });
  return res.addWorkspacePlugin;
}

export async function updateWorkspacePlugin(
  input: UpdateWorkspacePluginInput,
): Promise<RegistryEntry> {
  const res = await graphqlClient.request<{ updateWorkspacePlugin: RegistryEntry }>(
    UPDATE_MUTATION,
    { input },
  );
  return res.updateWorkspacePlugin;
}

export async function removeWorkspacePlugin(serverId: string, pluginId: string): Promise<void> {
  await graphqlClient.request(REMOVE_MUTATION, { serverId, pluginId });
}

/** What the server answers for an uploaded bundle. */
export interface UploadedBundle {
  sha256: string;
  size: number;
  url: string;
}

const CSRF_COOKIE = "rim_csrf";
const CSRF_HEADER = "x-csrf-token";

/**
 * Upload a bundle to the workspace's server, with the session and the CSRF header. A server
 * with workspace plugins switched off refuses it with a `FeatureDisabledError`.
 */
export async function uploadPluginBundle(
  serverId: string,
  bytes: Uint8Array,
  fetchImpl: typeof fetch = fetch,
): Promise<UploadedBundle> {
  const headers: Record<string, string> = { "Content-Type": BUNDLE_MEDIA_TYPE };
  const csrf = getCookie(CSRF_COOKIE);
  if (csrf) headers[CSRF_HEADER] = csrf;
  const response = await fetchImpl(
    `${getApiOrigin()}/api/plugin-bundles/${encodeURIComponent(serverId)}`,
    {
      method: "POST",
      credentials: "include",
      headers,
      body: bytes as BodyInit,
    },
  );
  if (!response.ok) {
    const disabled = await featureDisabledFromResponse(response);
    if (disabled) throw disabled;
    let reason = `${response.status}`;
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === "string") reason = body.error;
    } catch {
      // No JSON body: the status says enough.
    }
    throw new Error(`The bundle upload was refused: ${reason}`);
  }
  return (await response.json()) as UploadedBundle;
}
