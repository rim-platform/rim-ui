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
 * The connected server's release version, API version and features; needs no session. A
 * server that refuses `features` predates them and runs every feature, so it reads as listing
 * none.
 */
export async function fetchServerInfo(): Promise<ServerInfo> {
  try {
    const res = await graphqlClient.request<ServerInfoResponse>(SERVER_INFO_QUERY);
    return { ...res.serverInfo, features: res.serverInfo.features ?? [] };
  } catch (err) {
    if (!refusedByServer(err)) throw err;
    const res = await graphqlClient.request<ServerInfoResponse>(SERVER_VERSION_QUERY);
    return { ...res.serverInfo, features: [] };
  }
}
