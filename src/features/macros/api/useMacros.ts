import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import type {
  MacroStep as MacroStepGql,
  MacroDef,
  MacroStepInput,
  CreateMacroInput,
  UpdateMacroInput,
  ExecuteMacroInput,
} from "../../../core/graphql/generated/schema-types";

export type { CreateMacroInput, UpdateMacroInput, ExecuteMacroInput, MacroStepInput };

/** Output-side macro step with a non-nullable args convenience alias. */
export type MacroStep = MacroStepGql;

/** Subset of MacroDef used in list/detail views. */
export type Macro = Pick<MacroDef, "id" | "name" | "description" | "steps">;

const MyMacrosDocument = gql`
  query MyMacros($serverId: ID!) {
    myMacros(serverId: $serverId) {
      id
      name
      description
      steps {
        commandId
        args
      }
    }
  }
`;

const CreateMacroDocument = gql`
  mutation CreateMacro($input: CreateMacroInput!) {
    createMacro(input: $input) {
      id
      name
    }
  }
`;

const UpdateMacroDocument = gql`
  mutation UpdateMacro($input: UpdateMacroInput!) {
    updateMacro(input: $input) {
      id
      name
    }
  }
`;

const DeleteMacroDocument = gql`
  mutation DeleteMacro($macroId: ID!) {
    deleteMacro(macroId: $macroId)
  }
`;

const MacroByNameDocument = gql`
  query MacroByName($serverId: ID!, $name: String!) {
    macroByName(serverId: $serverId, name: $name) {
      id
      name
      description
    }
  }
`;

export const ExecuteMacroDocument = gql`
  mutation ExecuteMacro($input: ExecuteMacroInput!) {
    executeMacro(input: $input) {
      status
      message
    }
  }
`;

export function useMyMacros(serverId?: string) {
  return useQuery({
    queryKey: queryKeys.macros(serverId),
    enabled: Boolean(serverId),
    staleTime: 30_000,
    queryFn: async () => {
      const res = await graphqlClient.request<{ myMacros: Macro[] }>(
        MyMacrosDocument,
        { serverId },
      );
      return res.myMacros;
    },
  });
}

export function useCreateMacroMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMacroInput) =>
      graphqlClient.request(CreateMacroDocument, { input }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.macros(vars.serverId) });
    },
  });
}

export function useUpdateMacroMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateMacroInput) =>
      graphqlClient.request(UpdateMacroDocument, { input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.macros() });
    },
  });
}

export function useDeleteMacroMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (macroId: string) =>
      graphqlClient.request(DeleteMacroDocument, { macroId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.macros() });
    },
  });
}

export function useExecuteMacroMutation() {
  return useMutation({
    mutationFn: (input: ExecuteMacroInput) =>
      graphqlClient.request<{ executeMacro: { status: string; message: string } }>(
        ExecuteMacroDocument,
        { input },
      ),
  });
}

/**
 * Resolve a macro name to its definition (including the ID).
 * Returns null if the macro does not exist.
 */
export async function fetchMacroByName(
  serverId: string,
  name: string,
): Promise<Macro | null> {
  const res = await graphqlClient.request<{ macroByName: Macro | null }>(
    MacroByNameDocument,
    { serverId, name },
  );
  return res.macroByName;
}
