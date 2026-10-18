/**
 * Domain wrapper types for the auth feature.
 *
 * The backend emits GraphQL type names with a `Gql` suffix (e.g.
 * `RegistrationModeGql`). The generated TypeScript enum values are used
 * directly at the network boundary. Inside the feature, this module re-exports
 * them under cleaner aliases so component code reads:
 *
 *   `mode === RegistrationMode.OPEN`
 *
 * rather than:
 *
 *   `mode === RegistrationModeGql.OPEN`
 *
 * This wrapper layer is intentionally thin — no logic, just re-exports.
 */

import { RegistrationModeGql, InviteTokenTypeGql } from "../../core/graphql/generated/schema-types";

/** Deployment-wide registration mode returned by `registrationMode` query. */
export type RegistrationMode = RegistrationModeGql;
export const RegistrationMode = RegistrationModeGql;

/** Discriminator for what kind of token a `/join/:token` URL carries. */
export type InviteTokenType = InviteTokenTypeGql;
export const InviteTokenType = InviteTokenTypeGql;

/**
 * Minimal workspace context surfaced by a token preview.
 * Matches `WorkspaceInvitePreviewGql` from generated types.
 */
export interface WorkspaceInvitePreview {
  serverId: string;
  serverName: string;
  invitedByDisplayName: string;
  /** The owner's display name, else username; null when the workspace has no owner. */
  ownerDisplayName: string | null;
}

/**
 * Shape returned by `usePreviewInviteToken`.
 * Matches `InviteTokenPreviewGql` from generated types.
 */
export interface InviteTokenPreview {
  tokenType: InviteTokenType;
  expiresAt: string | null;
  workspace: WorkspaceInvitePreview | null;
}

/**
 * Discriminator for the error codes the preview endpoint can return.
 * The backend collapses missing/consumed/revoked into `INVALID_TOKEN`.
 */
export type InviteErrorCode = "INVALID_TOKEN" | "EXPIRED_TOKEN" | "NETWORK";
