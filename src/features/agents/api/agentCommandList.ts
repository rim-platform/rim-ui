/** The commands the server lists for agents, per workspace, for an outside agent. */

import { useQueries } from "@tanstack/react-query";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import { AI_COMMANDS_QUERY } from "../../agent/tools/loader";
import { offeredCommands, type AgentCommand } from "../runtime/agentCommands";

/**
 * The commands the server lists for agents in one workspace, fetched now rather than from a cache.
 *
 * @param workspaceId - The workspace the list is for.
 * @returns The commands, AI-callable or not as the server marks them.
 */
export async function fetchAgentCommands(workspaceId: string): Promise<AgentCommand[]> {
  const answer = await graphqlClient.request<{ commands: AgentCommand[] }>(AI_COMMANDS_QUERY, {
    commandContext: { workspaceId },
  });
  return answer.commands;
}

/** The commands RIM offers an outside agent across some workspaces, and how loading them went. */
export interface OfferedCommandList {
  /** Each offered command once, in the order the first workspace listing it gave. */
  commands: AgentCommand[];
  isPending: boolean;
  /** Whether a workspace's list could not be loaded. */
  isError: boolean;
}

/**
 * The commands RIM offers an outside agent in any of `workspaceIds`.
 *
 * @param workspaceIds - The workspaces the agent has a grant in.
 * @returns The offered commands, merged by id.
 */
export function useOfferedCommandList(workspaceIds: readonly string[]): OfferedCommandList {
  const results = useQueries({
    queries: workspaceIds.map((workspaceId) => ({
      queryKey: queryKeys.commands("AI", workspaceId),
      queryFn: () => fetchAgentCommands(workspaceId),
    })),
  });
  const byId = new Map<string, AgentCommand>();
  for (const result of results) {
    for (const command of offeredCommands(result.data ?? [])) {
      if (!byId.has(command.id)) byId.set(command.id, command);
    }
  }
  return {
    commands: [...byId.values()],
    isPending: results.some((result) => result.isPending),
    isError: results.some((result) => result.isError),
  };
}
