import { useMutation, useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { isSchemaRefusal } from "../../../core/graphql/errors";
import { forgetSpace } from "../../relay/state/spaces";
import { hostOf } from "../../relay/state/useRelayStore";
import { expectDeparture, forgetDeparture, leaveWorkspace } from "../state/memberEvents";
import { applyWorkspaceName } from "../state/workspaceName";

const LEAVE_WORKSPACE = gql`
  mutation LeaveWorkspace($serverId: ID!) {
    leaveWorkspace(serverId: $serverId)
  }
`;

const RENAME_WORKSPACE = gql`
  mutation RenameWorkspace($serverId: ID!, $name: String!) {
    renameWorkspace(serverId: $serverId, name: $name) {
      id
      name
    }
  }
`;

/** What the app says when a workspace's server is older than the action. */
export const UNSUPPORTED_BY_SERVER = "This workspace's server does not support this yet.";

/** Turns a refusal of the document itself into the message for a server that is too old. */
function explained(err: unknown): unknown {
  return isSchemaRefusal(err) ? new Error(UNSUPPORTED_BY_SERVER) : err;
}

/**
 * Leaves a workspace: it drops off the rail, the selection moves on when it was open, and a
 * workspace on another server is forgotten. The `MemberLeft` the server sends for it shows no
 * toast.
 */
export function useLeaveWorkspaceMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ serverId }: { serverId: string }) => {
      expectDeparture(serverId);
      try {
        await graphqlClient.request<{ leaveWorkspace: boolean }>(LEAVE_WORKSPACE, { serverId });
      } catch (err) {
        forgetDeparture(serverId);
        throw explained(err);
      }
    },
    onSuccess: async (_, { serverId }) => {
      const remote = hostOf(serverId);
      leaveWorkspace(qc, serverId);
      if (!remote) return;
      // The host's MemberLeft names the account by the host's id, so it never clears the mark.
      forgetDeparture(serverId);
      await forgetSpace(serverId);
    },
  });
}

/** Renames a workspace, showing the new name everywhere at once. */
export function useRenameWorkspaceMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ serverId, name }: { serverId: string; name: string }) => {
      try {
        const res = await graphqlClient.request<{
          renameWorkspace: { id: string; name: string };
        }>(RENAME_WORKSPACE, { serverId, name });
        return res.renameWorkspace;
      } catch (err) {
        throw explained(err);
      }
    },
    onSuccess: (server) => applyWorkspaceName(qc, server.id, server.name),
  });
}
