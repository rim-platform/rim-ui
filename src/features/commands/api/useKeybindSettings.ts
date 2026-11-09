import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import type {
  CreateKeybindInput,
  UpdateKeybindInput,
  DeleteKeybindInput,
  KeybindContext,
  KeybindScope,
} from "../types";

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

/** A keybind the server saved, as its keybind mutations return it. */
export interface SavedKeybind {
  id: string;
  keystroke: string;
  commandId: string;
  context: KeybindContext;
  scope: KeybindScope;
  isEnabled: boolean;
}

/** Saves a new keybind on the server and returns it. */
export async function createKeybind(input: CreateKeybindInput): Promise<SavedKeybind> {
  const res = await graphqlClient.request<{ createKeybind: SavedKeybind }>(CreateKeybindDocument, {
    input,
  });
  return res.createKeybind;
}

/** Changes a keybind on the server and returns it. */
export async function updateKeybind(input: UpdateKeybindInput): Promise<SavedKeybind> {
  const res = await graphqlClient.request<{ updateKeybind: SavedKeybind }>(UpdateKeybindDocument, {
    input,
  });
  return res.updateKeybind;
}

/** Deletes a keybind on the server. */
export async function deleteKeybind(input: DeleteKeybindInput): Promise<void> {
  await graphqlClient.request(DeleteKeybindDocument, { input });
}

/** Drops the cached keybind lists, so they are read from the server again. */
export function invalidateKeybinds(qc: QueryClient): void {
  qc.invalidateQueries({ queryKey: queryKeys.keybinds() });
  qc.invalidateQueries({ queryKey: ["resolvedKeybinds"] });
}

export function useCreateKeybindMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createKeybind,
    onSuccess: () => invalidateKeybinds(qc),
  });
}

export function useUpdateKeybindMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateKeybind,
    onSuccess: () => invalidateKeybinds(qc),
  });
}

export function useDeleteKeybindMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteKeybind,
    onSuccess: () => invalidateKeybinds(qc),
  });
}
