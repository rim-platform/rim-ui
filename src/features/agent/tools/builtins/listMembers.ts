import { gql } from "graphql-request";
import { graphqlClient } from "../../../../core/graphql/client";
import { registerTool } from "../registry";

const MEMBERS_QUERY = gql`
  query AgentListMembers($serverId: ID!) {
    serverMembers(serverId: $serverId) {
      userId
      username
      memberRole
      joinedAt
    }
  }
`;

interface MemberItem {
  userId: string;
  username: string;
  memberRole: string;
  joinedAt: string;
}

export function registerListMembersTool(): void {
  registerTool(
    {
      name: "list_members",
      description: "List all members in the workspace with their usernames and roles.",
      input_schema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "The workspace/server ID" },
        },
        required: ["workspace_id"],
      },
    },
    async (input) => {
      const res = await graphqlClient.request<{ serverMembers: MemberItem[] }>(
        MEMBERS_QUERY,
        { serverId: input.workspace_id as string },
      );
      const members = res.serverMembers.map((m) => ({
        username: m.username,
        role: m.memberRole,
        joined: m.joinedAt,
      }));
      return JSON.stringify(members);
    },
  );
}
