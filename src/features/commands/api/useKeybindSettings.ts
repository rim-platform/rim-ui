import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import type {
  KeybindScope,
  ResolvedKeybind,
  CreateKeybindInput,
  UpdateKeybindInput,
  DeleteKeybindInput,
} from "../types";

const KeybindsDocument = gql`
  query Keybinds($scope: KeybindScope!, $workspaceId: ID) {
    keybinds(scope: $scope, workspaceId: $workspaceId) {
      id
      keystroke
      commandId
      context
      source
      scope
      isEnabled
      presetArgs
    }
  }
`;

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

export function useKeybindsByScope(scope: KeybindScope, workspaceId?: string) {
  return useQuery({
    queryKey: queryKeys.keybinds(scope, workspaceId),
    queryFn: async () => {
      const res = await graphqlClient.request<{ keybinds: ResolvedKeybind[] }>(KeybindsDocument, {
        scope,
        workspaceId,
      });
      return res.keybinds;
    },
  });
}

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
