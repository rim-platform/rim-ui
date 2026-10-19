import { useMutation, useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import {
  ServerMemberRoleGql,
  type WorkspaceInvite,
} from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";

const CREATE_INVITE_MUTATION = gql`
  mutation CreateInvite($input: CreateInviteInput!) {
    createInvite(input: $input) {
      inviteToken
      inviteId
    }
  }
`;

const REVOKE_INVITE_MUTATION = gql`
  mutation RevokeInvite($inviteId: ID!) {
    revokeInvite(inviteId: $inviteId) {
      id
      state
      revokedAt
    }
  }
`;

const JOIN_SERVER_BY_INVITE_MUTATION = gql`
  mutation JoinServerByInvite($input: JoinServerByInviteInput!) {
    joinServerByInvite(input: $input) {
      serverId
    }
  }
`;

interface CreateInviteResponse {
  createInvite: {
    inviteToken: string;
    inviteId: string;
  };
}

interface RevokeInviteResponse {
  revokeInvite: Pick<WorkspaceInvite, "id" | "state" | "revokedAt">;
}

interface JoinServerByInviteResponse {
  joinServerByInvite: {
    serverId: string;
  };
}

/** The uses of a new invite, unless the instance allows fewer. */
export const DEFAULT_INVITE_USES = 10;

/** The lifetimes a new invite can be given, in days: the server refuses more than 30. */
export const INVITE_EXPIRY_DAYS = [1, 7, 30] as const;

/** One of the offered invite lifetimes, in days. */
export type InviteExpiryDays = (typeof INVITE_EXPIRY_DAYS)[number];

/** The lifetime of a new invite when none is picked; the server applies the same default. */
export const DEFAULT_INVITE_EXPIRY_DAYS: InviteExpiryDays = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Taken off a requested expiry so a device clock slightly ahead of the server's still fits. */
const EXPIRY_CLOCK_MARGIN_MS = 10 * 60 * 1000;

/**
 * The `expiresAt` sent for an invite that should last `days` days from `now`, a few minutes
 * short so that the server's "at most 30 days from now" check passes on a clock a little ahead.
 *
 * @returns An RFC 3339 timestamp.
 */
export function inviteExpiresAt(days: InviteExpiryDays, now: number = Date.now()): string {
  return new Date(now + days * DAY_MS - EXPIRY_CLOCK_MARGIN_MS).toISOString();
}

/**
 * Creates a workspace invite. `recipientEmail` is optional and best-effort —
 * when provided, the backend also emails the invite link, but the raw
 * `inviteToken`/link is always returned and shown regardless of whether the
 * email send succeeds. Omit it (or pass an empty string) for the link-only
 * path.
 *
 * `role` is what the invite grants on join: `MEMBER` (the default) or `GUEST`.
 * `maxUses` defaults to `DEFAULT_INVITE_USES`. `expiresInDays` is one of
 * `INVITE_EXPIRY_DAYS`; left out, the server's seven-day default applies. The
 * workspace's invite list is refetched afterwards.
 */
export function useCreateInviteMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      serverId,
      recipientEmail,
      role = ServerMemberRoleGql.MEMBER,
      maxUses = DEFAULT_INVITE_USES,
      expiresInDays,
    }: {
      serverId: string;
      recipientEmail?: string;
      role?: ServerMemberRoleGql.MEMBER | ServerMemberRoleGql.GUEST;
      maxUses?: number;
      expiresInDays?: InviteExpiryDays;
    }) =>
      graphqlClient.request<CreateInviteResponse>(CREATE_INVITE_MUTATION, {
        input: {
          serverId,
          maxUses,
          role,
          ...(expiresInDays !== undefined ? { expiresAt: inviteExpiresAt(expiresInDays) } : {}),
          ...(recipientEmail ? { recipientEmail } : {}),
        },
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.workspaceInvites(vars.serverId) });
    },
  });
}

/**
 * Revokes a workspace invite (owner only): it admits nobody from then on. Revoking a revoked
 * invite succeeds unchanged. The workspace's invite list is refetched afterwards.
 */
export function useRevokeInviteMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ inviteId }: { serverId: string; inviteId: string }) =>
      graphqlClient.request<RevokeInviteResponse>(REVOKE_INVITE_MUTATION, { inviteId }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.workspaceInvites(vars.serverId) });
    },
  });
}

/** Joins a workspace by invite; the workspace list is refetched so the rail shows it. */
export function useJoinServerByInviteMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (inviteToken: string) =>
      graphqlClient.request<JoinServerByInviteResponse>(JOIN_SERVER_BY_INVITE_MUTATION, {
        input: { inviteToken },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.myServers() });
    },
  });
}
