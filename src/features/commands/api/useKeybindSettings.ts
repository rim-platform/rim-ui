import { useMutation, useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import type { CreateKeybindInput, UpdateKeybindInput, DeleteKeybindInput } from "../types";

const CreateKeybindDocument = gql`
  mutation CreateKeybind($input: CreateKeybindInput!) {
    createKeybind(input: $input) {
      id
      keystroke
      commandId
      context
      scope
      isEnabled
    }
  }
`;

const UpdateKeybindDocument = gql`
  mutation UpdateKeybind($input: UpdateKeybindInput!) {
    updateKeybind(input: $input) {
      id
      keystroke
      commandId
      context
      scope
      isEnabled
    }
  }
`;

const DeleteKeybindDocument = gql`
  mutation DeleteKeybind($input: DeleteKeybindInput!) {
    deleteKeybind(input: $input)
  }
`;

export function useCreateKeybindMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateKeybindInput) =>
      graphqlClient.request(CreateKeybindDocument, { input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.keybinds() });
      qc.invalidateQueries({ queryKey: ["resolvedKeybinds"] });
    },
  });
}

export function useUpdateKeybindMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateKeybindInput) =>
      graphqlClient.request(UpdateKeybindDocument, { input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.keybinds() });
      qc.invalidateQueries({ queryKey: ["resolvedKeybinds"] });
    },
  });
}

export function useDeleteKeybindMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DeleteKeybindInput) =>
      graphqlClient.request(DeleteKeybindDocument, { input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.keybinds() });
      qc.invalidateQueries({ queryKey: ["resolvedKeybinds"] });
    },
  });
}
