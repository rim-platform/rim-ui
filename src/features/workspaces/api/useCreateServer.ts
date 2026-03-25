import { useMutation, useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";

const CREATE_SERVER_MUTATION = gql`
  mutation CreateServer($input: CreateServerInput!) {
    createServer(input: $input) {
      id
      name
    }
  }
`;

interface CreateServerInput {
  name: string;
}

interface CreateServerResponse {
  createServer: {
    id: string;
    name: string;
  };
}

export function useCreateServerMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateServerInput) =>
      graphqlClient.request<CreateServerResponse>(CREATE_SERVER_MUTATION, { input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.myServers() });
    },
  });
}
