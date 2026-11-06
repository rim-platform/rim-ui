import { useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import type { BotInfo, ServerMemberRoleGql } from "../../../core/graphql/generated/schema-types";
import { withOfflineSnapshot } from "../../offline/api/offlineSnapshot";
import { botDisclosureDocument } from "../../updater/api/serverCapabilities";

const SERVER_MEMBERS_QUERY = gql`
  query ServerMembers($serverId: ID!) {
    serverMembers(serverId: $serverId) {
      userId
      username
      memberRole
      joinedAt
      avatarUrl
      statusText
      bio
      displayName
      timeoutUntil
      principalId
    }
  }
`;

/** The same with `isBot` and `bot`, for a server that lists `bot_disclosure`. */
const SERVER_MEMBERS_WITH_BOTS_QUERY = gql`
  query ServerMembersWithBots($serverId: ID!) {
    serverMembers(serverId: $serverId) {
      userId
      username
      memberRole
      joinedAt
      avatarUrl
      statusText
      bio
      displayName
      timeoutUntil
      principalId
      isBot
      bot {
        runBy
        readsGoTo
        addedByName
      }
    }
  }
`;

export interface ServerMember {
  userId: string;
  username: string;
  memberRole: ServerMemberRoleGql;
  joinedAt: string;
  avatarUrl: string | null;
  statusText: string | null;
  bio: string | null;
  displayName: string | null;
  /** End of the member's timeout while one is in force, else null. */
  timeoutUntil?: string | null;
  /** The member's key identity (`rimp1_…`) once enrolled; null for a password-only account. */
  principalId?: string | null;
  /** Whether the member is a bot; absent from a server without `bot_disclosure`. */
  isBot?: boolean;
  /** What the person who added a bot says about it; null for a person. */
  bot?: BotInfo | null;
}

/** The workspace's members, from the server or (offline, on the desktop) its saved copy. */
export function fetchServerMembers(serverId: string): Promise<ServerMember[]> {
  return withOfflineSnapshot("members", serverId, async () => {
    const document = await botDisclosureDocument({
      plain: SERVER_MEMBERS_QUERY,
      withBots: SERVER_MEMBERS_WITH_BOTS_QUERY,
    });
    const res = await graphqlClient.request<{ serverMembers: ServerMember[] }>(document, {
      serverId,
    });
    return res.serverMembers;
  });
}

export function useServerMembers(serverId?: string) {
  return useQuery({
    queryKey: queryKeys.serverMembers(serverId),
    enabled: Boolean(serverId),
    staleTime: 60_000,
    // Runs offline too: the desktop app answers from its saved copy (offlineSnapshot.ts).
    networkMode: "offlineFirst",
    queryFn: () => fetchServerMembers(serverId!),
  });
}
