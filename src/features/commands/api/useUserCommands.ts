import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import type {
  QueryUserCommandArgs,
  UserCommand,
} from "../../../core/graphql/generated/schema-types";
import type {
  CreateUserCommandInput,
  UpdateUserCommandInput,
  DeleteUserCommandInput,
} from "../types";

/** A user command as its owner saved it: title, description, steps in order and enabled flag. */
export type SavedUserCommand = Pick<
  UserCommand,
  "id" | "title" | "description" | "steps" | "isEnabled"
>;

/** A user command's id with the command id of each of its steps, enough to count them. */
export type UserCommandStepSummary = Pick<UserCommand, "id"> & {
  steps: Pick<UserCommand["steps"][number], "commandId">[];
};

const UserCommandDocument = gql`
  query UserCommand($id: String!) {
    userCommand(id: $id) {
      id
      title
      description
      isEnabled
      steps {
        commandId
        args
      }
    }
  }
`;

const UserCommandsDocument = gql`
  query UserCommands {
    userCommands {
      id
      steps {
        commandId
      }
    }
  }
`;

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

/**
 * One of the signed-in account's user commands with its saved steps, fetched while `id` is set.
 * The entry is dropped as soon as nothing reads it, so each opening loads what is saved now. A
 * null answer means the listed command is gone, so the command lists are refreshed.
 *
 * @param id - The command id (`user.<key>`), or null to fetch nothing.
 * @returns The query; its data is null when the account has no user command with that id.
 */
export function useUserCommand(id: string | null) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: queryKeys.userCommand(id),
    enabled: id !== null,
    gcTime: 0,
    queryFn: async (): Promise<SavedUserCommand | null> => {
      const res = await graphqlClient.request<
        { userCommand: SavedUserCommand | null },
        QueryUserCommandArgs
      >(UserCommandDocument, { id: id ?? "" });
      if (!res.userCommand) {
        qc.invalidateQueries({ queryKey: ["commands"] });
        return null;
      }
      return res.userCommand;
    },
  });
}

/**
 * The signed-in account's user commands, disabled ones included, each with the command id of
 * its steps.
 */
export function useUserCommandSteps() {
  return useQuery({
    queryKey: queryKeys.userCommands,
    queryFn: async (): Promise<UserCommandStepSummary[]> => {
      const res = await graphqlClient.request<{ userCommands: UserCommandStepSummary[] }>(
        UserCommandsDocument,
      );
      return res.userCommands;
    },
  });
}

/** Creates a user command, then refreshes the command lists and the saved user commands. */
export function useCreateUserCommandMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateUserCommandInput) =>
      graphqlClient.request(CreateUserCommandDocument, { input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["commands"] });
      qc.invalidateQueries({ queryKey: queryKeys.userCommands });
    },
  });
}

/** Replaces a user command, then refreshes the command lists and the saved user commands. */
export function useUpdateUserCommandMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateUserCommandInput) =>
      graphqlClient.request(UpdateUserCommandDocument, { input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["commands"] });
      qc.invalidateQueries({ queryKey: queryKeys.userCommands });
    },
  });
}

/** Deletes a user command, then refreshes the command lists and the saved user commands. */
export function useDeleteUserCommandMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DeleteUserCommandInput) =>
      graphqlClient.request(DeleteUserCommandDocument, { input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["commands"] });
      qc.invalidateQueries({ queryKey: queryKeys.userCommands });
    },
  });
}
