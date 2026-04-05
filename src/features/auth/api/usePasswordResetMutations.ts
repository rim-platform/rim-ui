import { useMutation } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";

// TODO: These mutations may not exist in the backend yet.
// Strange is working on them. The UI is ready to use them once available.

const REQUEST_PASSWORD_RESET_MUTATION = gql`
  mutation RequestPasswordReset($username: String!) {
    requestPasswordReset(username: $username)
  }
`;

const RESET_PASSWORD_MUTATION = gql`
  mutation ResetPassword($token: String!, $newPassword: String!) {
    resetPassword(token: $token, newPassword: $newPassword)
  }
`;

interface RequestPasswordResetResponse {
  requestPasswordReset: boolean;
}

interface ResetPasswordResponse {
  resetPassword: boolean;
}

export function useRequestPasswordResetMutation() {
  return useMutation({
    mutationFn: (username: string) =>
      graphqlClient.request<RequestPasswordResetResponse>(REQUEST_PASSWORD_RESET_MUTATION, { username }),
  });
}

export function useResetPasswordMutation() {
  return useMutation({
    mutationFn: (input: { token: string; newPassword: string }) =>
      graphqlClient.request<ResetPasswordResponse>(RESET_PASSWORD_MUTATION, input),
  });
}
