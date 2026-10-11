import { useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import { withOfflineSnapshot } from "../../offline/api/offlineSnapshot";

const MY_SERVERS_QUERY = gql`
  query MyServers {
    myServers {
      id
      name
      owner {
        id
        username
        displayName
      }
    }
  }
`;

export interface Server {
  id: string;
  name: string;
  /** Null for the direct space, and once the owner's account is deleted. */
  owner: { id: string; username: string; displayName: string | null } | null;
}

interface MyServersResponse {
  myServers: Server[];
}

/** The workspaces this account is a member of on this server. */
export async function fetchMyServers(): Promise<Server[]> {
  const res = await graphqlClient.request<MyServersResponse>(MY_SERVERS_QUERY);
  return res.myServers;
}

export function useMyServers() {
  return useQuery({
    queryKey: queryKeys.myServers(),
    staleTime: 60_000,
    // Runs offline too: the desktop app answers from its saved copy (offlineSnapshot.ts).
    networkMode: "offlineFirst",
    queryFn: () => withOfflineSnapshot("servers", null, fetchMyServers),
  });
}
