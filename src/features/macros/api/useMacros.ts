import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";

export interface MacroStep {
  commandId: string;
  args: Record<string, unknown>;
}

export interface Macro {
  id: string;
  name: string;
  description: string;
  steps: MacroStep[];
}

export interface CreateMacroInput {
  serverId: string;
  name: string;
  description: string;
  steps: MacroStep[];
}

export interface UpdateMacroInput {
  macroId: string;
  name: string;
  description: string;
  steps: MacroStep[];
}

export interface ExecuteMacroInput {
  macroId: string;
  commandContext?: {
    workspaceId?: string;
    conversationId?: string;
  };
}

const macroQueryKeys = {
  myMacros: (serverId?: string) => ["macros", serverId] as const,
};

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

const ExecuteMacroDocument = gql`
  mutation ExecuteMacro($input: ExecuteMacroInput!) {
    executeMacro(input: $input) {
      status
      message
    }
  }
`;

export function useMyMacros(serverId?: string) {
  return useQuery({
    queryKey: macroQueryKeys.myMacros(serverId),
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
      qc.invalidateQueries({ queryKey: macroQueryKeys.myMacros(vars.serverId) });
    },
  });
}

export function useUpdateMacroMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateMacroInput) =>
      graphqlClient.request(UpdateMacroDocument, { input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["macros"] });
    },
  });
}

export function useDeleteMacroMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (macroId: string) =>
      graphqlClient.request(DeleteMacroDocument, { macroId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["macros"] });
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
