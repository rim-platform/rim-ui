import { useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import { withOfflineSnapshot } from "../../offline/api/offlineSnapshot";

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
    // Runs offline too: the desktop app answers from its saved copy (offlineSnapshot.ts).
    networkMode: "offlineFirst",
    queryFn: () =>
      withOfflineSnapshot("me", null, async () => {
        const res = await graphqlClient.request<MeResponse>(ME_QUERY);
        return res.me;
      }),
  });
}
