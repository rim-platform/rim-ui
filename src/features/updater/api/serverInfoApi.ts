import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import type { ServerInfo } from "../../../core/graphql/generated/schema-types";

/** The major GraphQL API version this client speaks. */
export const CLIENT_API_VERSION = 1;

const SERVER_INFO_QUERY = gql`
  query ServerInfo {
    serverInfo {
      version
      apiVersion
      features {
        key
        state
        reason
      }
      auditRetentionDays
    }
  }
`;

/** The same without `auditRetentionDays`, for a server older than audit retention. */
const SERVER_FEATURES_QUERY = gql`
  query ServerFeatures {
    serverInfo {
      version
      apiVersion
      features {
        key
        state
        reason
      }
    }
  }
`;

/** The same without `features`, for a server older than feature switches. */
const SERVER_VERSION_QUERY = gql`
  query ServerVersion {
    serverInfo {
      version
      apiVersion
    }
  }
`;

interface ServerInfoResponse {
  serverInfo: ServerInfo;
}

/** Whether the server answered with GraphQL errors, as opposed to not answering at all. */
function refusedByServer(err: unknown): boolean {
  const errors = (err as { response?: { errors?: unknown } } | null)?.response?.errors;
  return Array.isArray(errors) && errors.length > 0;
}

/**
 * The connected server's release version, API version, features and audit retention; needs no
 * session. Each query a server refuses falls back to the next older one. A server older than
 * audit retention leaves `auditRetentionDays` undefined (unknown, unlike `null`, which keeps rows
 * forever); one older than `features` runs every feature, so it reads as listing none.
 */
export async function fetchServerInfo(): Promise<ServerInfo> {
  for (const query of [SERVER_INFO_QUERY, SERVER_FEATURES_QUERY]) {
    try {
      const res = await graphqlClient.request<ServerInfoResponse>(query);
      return { ...res.serverInfo, features: res.serverInfo.features ?? [] };
    } catch (err) {
      if (!refusedByServer(err)) throw err;
    }
  }
  const res = await graphqlClient.request<ServerInfoResponse>(SERVER_VERSION_QUERY);
  return { ...res.serverInfo, features: [] };
}
