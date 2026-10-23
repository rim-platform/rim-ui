import { useMutation, useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import type { Mutation } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { useLocalDirectSpaceId } from "../../relay/runtime/useDirectSpaceRuntime";
import { useServerInfo } from "../../updater/hooks/useServerInfo";
import { useMyServers } from "../api/useMyServers";
import { useWorkspaceStore } from "../state/useWorkspaceStore";

export function JoinDefaultWorkspace() {
  const { info } = useServerInfo();
  const { data: servers } = useMyServers();
  const workspaceId = useWorkspaceStore((state) => state.workspaceId);
  const directSpaceId = useLocalDirectSpaceId();
  const qc = useQueryClient();
  const join = useMutation({
    mutationFn: () =>
      graphqlClient.request<Pick<Mutation, "joinDefaultWorkspace">>(gql`
        mutation {
          joinDefaultWorkspace
        }
      `),
    onSuccess: async (data) => {
      await qc.invalidateQueries({ queryKey: queryKeys.myServers() });
      useWorkspaceStore.getState().setWorkspaceId(data.joinDefaultWorkspace);
    },
  });
  const defaultId = info?.defaultWorkspace;
  if (
    !defaultId ||
    !servers ||
    workspaceId !== directSpaceId ||
    servers.some((server) => server.id === defaultId)
  )
    return null;
  return (
    <div className="border-b border-rim-line bg-rim-panel px-4 py-3 text-sm">
      <button
        type="button"
        disabled={join.isPending}
        onClick={() => join.mutate()}
        className="text-rim-accent disabled:opacity-50"
      >
        {join.isPending ? "Joining…" : "Join the default workspace"}
      </button>
      {join.isError && (
        <p role="alert" className="text-rim-danger">
          {join.error.message.includes("banned")
            ? "You are banned from the default workspace."
            : "Could not join the default workspace. Please try again."}
        </p>
      )}
    </div>
  );
}
