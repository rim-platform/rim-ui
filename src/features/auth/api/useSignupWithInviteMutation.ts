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
 * **Input fields (per amendment 2026-04-28b, reconciled with SDL):**
 * - `username` — required; user-facing unique handle.
 * - `email` — required; trimmed + lowercased server-side; case-insensitive
 *   unique. Returns `EMAIL_TAKEN` error extension code on conflict.
 * - `displayName` — optional (1–80 chars when present). Omit entirely (do NOT
 *   send `""`) when the user leaves the field blank. Falls back to `username`
 *   server-side when absent.
 * - `password` — required.
 * - `workspaceInviteToken` — from `/join/:token` URLs for workspace invites.
 * - `instanceInviteToken` — from `/join/:token` URLs for instance invites.
 * - `bootstrapToken` — from `/join/:token` URLs for bootstrap tokens (first-user
 *   provisioning). Distinct from `instanceInviteToken`; use `bootstrapToken` when
 *   the preview returns `tokenType === BOOTSTRAP`.
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
 * signup.mutate({ username, email, password, workspaceInviteToken: token });
 * // displayName is optional — omit entirely (not "") when blank.
 * ```
 */
export function useSignupWithInviteMutation() {
  return useMutation({
    mutationFn: (input: SignupWithInviteInput) =>
      graphqlClient.request<SignupWithInviteResponse>(SIGNUP_WITH_INVITE_MUTATION, { input }),
  });
}
