import { useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import { handleDomain } from "../../../shared/utils/handles";
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
      principalId
      handle
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
  /** The key identity id (`rimp1_…`) once the account enrolled a key, else null. */
  principalId: string | null;
  /** `@<username>:<domain>`; null when the server declares no handle domain. */
  handle?: string | null;
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

/**
 * The handle domain of the signed-in account's server, read from its own handle: people whose
 * handle has this domain are shown as `@username`. `null` while it is not known.
 */
export function useOwnHandleDomain(): string | null {
  return handleDomain(useCurrentUser().data?.handle);
}
