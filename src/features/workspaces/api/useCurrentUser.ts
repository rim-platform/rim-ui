import { useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";

const ME_QUERY = gql`
  query Me {
    me {
      id
      username
      displayName
      avatarUrl
      statusText
      bio
    }
  }
`;

interface User {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  statusText: string | null;
  bio: string | null;
}

interface MeResponse {
  me: User;
}

export function useCurrentUser() {
  return useQuery({
    queryKey: queryKeys.me,
    staleTime: 300_000,
    queryFn: async () => {
      const res = await graphqlClient.request<MeResponse>(ME_QUERY);
      return res.me;
    },
  });
}
