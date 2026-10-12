import { useMutation, useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import type {
  DeleteWorkspaceInput,
  TransferWorkspaceOwnershipInput,
} from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { expectDeparture, forgetDeparture, leaveWorkspace } from "../state/memberEvents";
import type { ServerDetail } from "./useWorkspace";

const TRANSFER_WORKSPACE_OWNERSHIP = gql`
  mutation TransferWorkspaceOwnership($input: TransferWorkspaceOwnershipInput!) {
    transferWorkspaceOwnership(input: $input) {
      id
      name
      viewerRole
    }
  }
`;

const DELETE_WORKSPACE = gql`
  mutation DeleteWorkspace($input: DeleteWorkspaceInput!) {
    deleteWorkspace(input: $input) {
      deleted
    }
  }
`;

/**
 * Makes another member the workspace's owner; the caller becomes a moderator, which the cached
 * workspace takes from the answer at once.
 */
export function useTransferOwnershipMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: TransferWorkspaceOwnershipInput) => {
      const res = await graphqlClient.request<{ transferWorkspaceOwnership: ServerDetail }>(
        TRANSFER_WORKSPACE_OWNERSHIP,
        { input },
      );
      return res.transferWorkspaceOwnership;
    },
    onSuccess: (server, input) => {
      qc.setQueryData(queryKeys.server(input.serverId), server);
      qc.invalidateQueries({ queryKey: queryKeys.serverMembers(input.serverId) });
    },
  });
}

/**
 * Deletes the workspace for good, with its name typed again, and leaves it: it drops off the
 * rail and, when open, the selection moves on. The `MemberLeft` the server sends for it is
 * expected and shows no toast.
 */
export function useDeleteWorkspaceMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: DeleteWorkspaceInput) => {
      expectDeparture(input.serverId);
      try {
        const res = await graphqlClient.request<{ deleteWorkspace: { deleted: boolean } }>(
          DELETE_WORKSPACE,
          { input },
        );
        if (!res.deleteWorkspace.deleted) throw new Error("The server did not delete it.");
      } catch (err) {
        forgetDeparture(input.serverId);
        throw err;
      }
    },
    onSuccess: (_, input) => leaveWorkspace(qc, input.serverId),
  });
}
