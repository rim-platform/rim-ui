import { useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";

const MY_SERVERS_QUERY = gql`
  query MyServers {
    myServers {
      id
      name
    }
  }
`;

interface Server {
  id: string;
  name: string;
}

interface MyServersResponse {
  myServers: Server[];
}

export function useMyServers() {
  return useQuery({
    queryKey: queryKeys.myServers(),
    staleTime: 60_000,
    queryFn: async () => {
      const res = await graphqlClient.request<MyServersResponse>(MY_SERVERS_QUERY);
      return res.myServers;
    },
  });
}
