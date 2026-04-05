import { useMutation } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";

const CREATE_INVITE_MUTATION = gql`
  mutation CreateInvite($serverId: ID!) {
    createInvite(serverId: $serverId) {
      token
    }
  }
`;

const JOIN_SERVER_BY_INVITE_MUTATION = gql`
  mutation JoinServerByInvite($inviteToken: String!) {
    joinServerByInvite(inviteToken: $inviteToken) {
      serverId
      userId
    }
  }
`;

interface CreateInviteResponse {
  createInvite: {
    token: string;
  };
}

interface JoinServerByInviteResponse {
  joinServerByInvite: {
    serverId: string;
    userId: string;
  };
}

export function useCreateInviteMutation() {
  return useMutation({
    mutationFn: (serverId: string) =>
      graphqlClient.request<CreateInviteResponse>(CREATE_INVITE_MUTATION, { serverId }),
  });
}

export function useJoinServerByInviteMutation() {
  return useMutation({
    mutationFn: (inviteToken: string) =>
      graphqlClient.request<JoinServerByInviteResponse>(JOIN_SERVER_BY_INVITE_MUTATION, { inviteToken }),
  });
}
