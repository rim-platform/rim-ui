import { useMutation } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { signInRequest } from "./signInRequest";

const LOGIN_MUTATION = gql`
  mutation Login($input: LoginInput!) {
    login(input: $input) {
      userId
      csrfToken
    }
  }
`;

/** The same without `csrfToken`, for a server older than it. */
const LOGIN_WITHOUT_CSRF_TOKEN_MUTATION = gql`
  mutation LoginWithoutCsrfToken($input: LoginInput!) {
    login(input: $input) {
      userId
    }
  }
`;

const LOGOUT_MUTATION = gql`
  mutation Logout {
    logout
  }
`;

interface LoginInput {
  username: string;
  password: string;
}

interface LoginResponse {
  login: {
    userId: string;
    csrfToken?: string;
  };
}

interface LogoutResponse {
  logout: boolean;
}

export function useLoginMutation() {
  return useMutation({
    mutationFn: (input: LoginInput) =>
      signInRequest<LoginResponse>("login", LOGIN_MUTATION, LOGIN_WITHOUT_CSRF_TOKEN_MUTATION, {
        input,
      }),
  });
}

/** End this session on the server. */
export function logout(): Promise<LogoutResponse> {
  return graphqlClient.request<LogoutResponse>(LOGOUT_MUTATION);
}
