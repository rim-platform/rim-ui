import { useMutation } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";

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

export function useCreateInviteMutation() {
  return useMutation({
    mutationFn: (serverId: string) =>
      graphqlClient.request<CreateInviteResponse>(CREATE_INVITE_MUTATION, {
        input: { serverId, maxUses: 10 },
      }),
  });
}

export function useJoinServerByInviteMutation() {
  return useMutation({
    mutationFn: (inviteToken: string) =>
      graphqlClient.request<JoinServerByInviteResponse>(JOIN_SERVER_BY_INVITE_MUTATION, {
        input: { inviteToken },
      }),
  });
}
