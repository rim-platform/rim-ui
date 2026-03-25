import { useMutation, useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";

const JOIN_SERVER_BY_INVITE = gql`
  mutation JoinServerByInvite($input: JoinServerByInviteInput!) {
    joinServerByInvite(input: $input) {
      serverId
    }
  }
`;

interface JoinServerByInviteResult {
  joinServerByInvite: {
    serverId: string;
  };
}

export function useJoinServerMutation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (inviteToken: string) =>
      graphqlClient.request<JoinServerByInviteResult>(JOIN_SERVER_BY_INVITE, {
        input: { inviteToken },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.myServers() });
    },
  });
}
