import { useMutation } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";

const LOGIN_MUTATION = gql`
  mutation Login($input: LoginInput!) {
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
  };
}

interface LogoutResponse {
  logout: boolean;
}

export function useLoginMutation() {
  return useMutation({
    mutationFn: (input: LoginInput) =>
      graphqlClient.request<LoginResponse>(LOGIN_MUTATION, { input }),
  });
}

export function useLogoutMutation() {
  return useMutation({
    mutationFn: () => graphqlClient.request<LogoutResponse>(LOGOUT_MUTATION),
  });
}
