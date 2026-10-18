/**
 * `usePreviewInviteToken` — previews a registration token without consuming it.
 *
 * Wraps the `previewInviteToken(token: String!)` GraphQL query. Returns
 * minimal metadata so the frontend can render the correct signup copy before
 * the user submits credentials.
 *
 * The backend rate-limits this endpoint at 30 req / 5 min per IP. No auth
 * required.
 *
 * On error, the GraphQL response carries `extensions.code`:
 * - `"INVALID_TOKEN"` — missing, consumed, or revoked token
 * - `"EXPIRED_TOKEN"` — valid token that has passed its expiry
 *
 * Unknown / network errors are surfaced as-is via TanStack Query's `error`.
 * Consumers use `extractInviteErrorCode` to map to the `InviteErrorCode`
 * discriminator before rendering copy.
 *
 * @param token - The raw token string, from the URL or an invite code.
 * @returns TanStack Query result containing `InviteTokenPreview` on success.
 */

import { useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import type { InviteTokenPreview, InviteErrorCode, WorkspaceInvitePreview } from "../types";

const PREVIEW_INVITE_TOKEN_QUERY = gql`
  query PreviewInviteToken($token: String!) {
    previewInviteToken(token: $token) {
      tokenType
      expiresAt
      workspace {
        serverId
        serverName
        invitedByDisplayName
        ownerDisplayName
      }
    }
  }
`;

interface PreviewInviteTokenResponse {
  previewInviteToken: {
    tokenType: string;
    expiresAt: string | null;
    workspace: WorkspaceInvitePreview | null;
  };
}

/**
 * Extracts the `InviteErrorCode` from a thrown GraphQL error.
 *
 * Checks `err.response.errors[0].extensions.code` for backend-typed error
 * codes. Falls back to `"NETWORK"` for all other failures.
 *
 * @param err - The raw error thrown by `graphqlClient.request`.
 * @returns The matching `InviteErrorCode` discriminator.
 */
export function extractInviteErrorCode(err: unknown): InviteErrorCode {
  if (err && typeof err === "object") {
    const gqlErr = err as { response?: { errors?: Array<{ extensions?: { code?: string } }> } };
    const code = gqlErr.response?.errors?.[0]?.extensions?.code;
    if (code === "INVALID_TOKEN" || code === "EXPIRED_TOKEN") {
      return code;
    }
  }
  return "NETWORK";
}

/**
 * Fetches a read-only preview of a registration token.
 *
 * @param token - The raw token, from the `/join/:token` URL or an invite code typed at signup.
 * @param enabled - Whether to fetch it; `false` leaves the query idle, as for a blank code.
 */
export function usePreviewInviteToken(token: string, enabled = true) {
  return useQuery<InviteTokenPreview, Error>({
    queryKey: queryKeys.previewInviteToken(token),
    enabled,
    queryFn: async (): Promise<InviteTokenPreview> => {
      const res = await graphqlClient.request<PreviewInviteTokenResponse>(
        PREVIEW_INVITE_TOKEN_QUERY,
        { token },
      );
      const raw = res.previewInviteToken;
      return {
        tokenType: raw.tokenType as InviteTokenPreview["tokenType"],
        expiresAt: raw.expiresAt,
        workspace: raw.workspace,
      };
    },
    retry: false,
    staleTime: 60 * 1000, // 1 minute — token state is fairly stable
  });
}
