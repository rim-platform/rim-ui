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
    }
  }
`;

interface ServerInfoResponse {
  serverInfo: ServerInfo;
}

/** The connected server's release version and API version; needs no session. */
export async function fetchServerInfo(): Promise<ServerInfo> {
  const res = await graphqlClient.request<ServerInfoResponse>(SERVER_INFO_QUERY);
  return res.serverInfo;
}
