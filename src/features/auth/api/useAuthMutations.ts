import { useMutation } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";

const BOOTSTRAP_MUTATION = gql`
  mutation Bootstrap($input: BootstrapInput!) {
    bootstrap(input: $input) {
      userId
      serverId
    }
  }
`;

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

interface BootstrapInput {
  secret: string;
  username: string;
  password: string;
  serverName: string;
}

interface LoginInput {
  username: string;
  password: string;
}

interface BootstrapResponse {
  bootstrap: {
    userId: string;
    serverId: string;
  };
}

interface LoginResponse {
  login: {
    userId: string;
  };
}

interface LogoutResponse {
  logout: boolean;
}

export function useBootstrapMutation() {
  return useMutation({
    mutationFn: (input: BootstrapInput) =>
      graphqlClient.request<BootstrapResponse>(BOOTSTRAP_MUTATION, { input }),
  });
}

export function useLoginMutation() {
  return useMutation({
    mutationFn: (input: LoginInput) =>
      graphqlClient.request<LoginResponse>(LOGIN_MUTATION, { input }),
  });
}

export function useLogoutMutation() {
  return useMutation({
    mutationFn: () =>
      graphqlClient.request<LogoutResponse>(LOGOUT_MUTATION),
  });
}
