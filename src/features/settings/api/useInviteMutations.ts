import { useMutation, useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { ServerMemberRoleGql } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";

const CREATE_INVITE_MUTATION = gql`
  mutation CreateInvite($input: CreateInviteInput!) {
    createInvite(input: $input) {
      inviteToken
      inviteId
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

interface JoinServerByInviteResponse {
  joinServerByInvite: {
    serverId: string;
  };
}

/** The uses of a new invite, unless the instance allows fewer. */
export const DEFAULT_INVITE_USES = 10;

/**
 * Creates a workspace invite. `recipientEmail` is optional and best-effort —
 * when provided, the backend also emails the invite link, but the raw
 * `inviteToken`/link is always returned and shown regardless of whether the
 * email send succeeds (Track B3, `track-b3-email.md` §5). Omit it (or pass
 * an empty string) for the link-only path, unchanged from before B3.
 *
 * `role` is what the invite grants on join (Track 1.2): `MEMBER` (the default) or `GUEST`.
 * `maxUses` defaults to `DEFAULT_INVITE_USES`.
 */
export function useCreateInviteMutation() {
  return useMutation({
    mutationFn: ({
      serverId,
      recipientEmail,
      role = ServerMemberRoleGql.MEMBER,
      maxUses = DEFAULT_INVITE_USES,
    }: {
      serverId: string;
      recipientEmail?: string;
      role?: ServerMemberRoleGql.MEMBER | ServerMemberRoleGql.GUEST;
      maxUses?: number;
    }) =>
      graphqlClient.request<CreateInviteResponse>(CREATE_INVITE_MUTATION, {
        input: {
          serverId,
          maxUses,
          role,
          ...(recipientEmail ? { recipientEmail } : {}),
        },
      }),
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
