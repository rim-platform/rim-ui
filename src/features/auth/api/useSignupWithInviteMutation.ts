/**
 * `useSignupWithInviteMutation` — unified signup for all token-based and
 * open-mode registration paths.
 *
 * Wraps the `signupWithInvite(input: SignupWithInviteInput!)` GraphQL mutation.
 * In invite-only mode exactly one of `bootstrapToken`, `instanceInviteToken`,
 * or `workspaceInviteToken` must be supplied. In open mode all token fields
 * must be absent.
 *
 * The backend sets session and CSRF cookies on success, matching the behavior
 * of the `login` mutation.
 *
 * **Input field notes (reconciled with SDL):**
 * - `username` is the user-facing identifier (not `email` — spec r2 drift vs
 *   actual SDL; the backend does not have an `email` field).
 * - `displayName` is NOT in the SDL — the backend derives it server-side.
 *   This is a naming drift from the original spec §4.2. No `displayName` field
 *   should be rendered; see `JoinForm` docs.
 * - `workspaceInviteToken` maps to the token from `/join/:token` URLs for
 *   workspace invites.
 * - `instanceInviteToken` maps to the token from `/join/:token` URLs for
 *   instance invites (bootstrap and admin-issued).
 *
 * @returns TanStack Query mutation result. On success, `data.signupWithInvite`
 *   contains `{ userId, serverId? }`. `serverId` is present only for workspace
 *   invite tokens.
 */

import { useMutation } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import type { SignupWithInviteInput } from "../../../core/graphql/generated/schema-types";

const SIGNUP_WITH_INVITE_MUTATION = gql`
  mutation SignupWithInvite($input: SignupWithInviteInput!) {
    signupWithInvite(input: $input) {
      userId
      serverId
    }
  }
`;

export interface SignupWithInviteResponse {
  signupWithInvite: {
    userId: string;
    serverId: string | null;
  };
}

/**
 * Mutation hook for registering a new account.
 *
 * Accepts a `SignupWithInviteInput` directly from the generated schema types
 * so callers never hand-write enum values or field names.
 *
 * Usage:
 * ```ts
 * const signup = useSignupWithInviteMutation();
 * signup.mutate({ username, password, workspaceInviteToken: token });
 * ```
 */
export function useSignupWithInviteMutation() {
  return useMutation({
    mutationFn: (input: SignupWithInviteInput) =>
      graphqlClient.request<SignupWithInviteResponse>(
        SIGNUP_WITH_INVITE_MUTATION,
        { input },
      ),
  });
}
