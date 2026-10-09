/** The signed-in account's sessions on the server. */

import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import type { Mutation } from "../../../core/graphql/generated/schema-types";

const LOGOUT_OTHER_SESSIONS_MUTATION = gql`
  mutation LogoutOtherSessions {
    logoutOtherSessions
  }
`;

type LogoutOtherSessionsResponse = Pick<Mutation, "logoutOtherSessions">;

/** End every session of the account except this one. Resolves to how many ended. */
export async function logoutOtherSessions(): Promise<number> {
  const data = await graphqlClient.request<LogoutOtherSessionsResponse>(
    LOGOUT_OTHER_SESSIONS_MUTATION,
  );
  return data.logoutOtherSessions;
}
