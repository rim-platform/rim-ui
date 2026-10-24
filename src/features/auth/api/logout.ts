import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";

const LOGOUT_MUTATION = gql`
  mutation Logout {
    logout
  }
`;

interface LogoutResponse {
  logout: boolean;
}

/** End this session on the server. */
export function logout(): Promise<LogoutResponse> {
  return graphqlClient.request<LogoutResponse>(LOGOUT_MUTATION);
}
