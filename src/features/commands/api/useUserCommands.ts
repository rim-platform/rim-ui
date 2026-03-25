import { useMutation, useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import type {
  CreateUserCommandInput,
  UpdateUserCommandInput,
  DeleteUserCommandInput,
} from "../types";

const CreateUserCommandDocument = gql`
  mutation CreateUserCommand($input: CreateUserCommandInput!) {
    createUserCommand(input: $input) {
      id
      title
      description
      category
      sourceKind
      keybindCapable
    }
  }
`;

const UpdateUserCommandDocument = gql`
  mutation UpdateUserCommand($input: UpdateUserCommandInput!) {
    updateUserCommand(input: $input) {
      id
      title
      description
      category
      sourceKind
      keybindCapable
    }
  }
`;

const DeleteUserCommandDocument = gql`
  mutation DeleteUserCommand($input: DeleteUserCommandInput!) {
    deleteUserCommand(input: $input)
  }
`;

export function useCreateUserCommandMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateUserCommandInput) =>
      graphqlClient.request(CreateUserCommandDocument, { input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["commands"] });
    },
  });
}

export function useUpdateUserCommandMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateUserCommandInput) =>
      graphqlClient.request(UpdateUserCommandDocument, { input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["commands"] });
    },
  });
}

export function useDeleteUserCommandMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DeleteUserCommandInput) =>
      graphqlClient.request(DeleteUserCommandDocument, { input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["commands"] });
    },
  });
}
