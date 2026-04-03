import { gql } from "graphql-request";
import { graphqlClient } from "../../../../core/graphql/client";
import { registerTool } from "../registry";

const CHANNELS_QUERY = gql`
  query AgentListChannels($serverId: ID!) {
    conversations(serverId: $serverId, filter: CHANNEL) {
      items {
        id
        title
        conversationType
      }
    }
  }
`;

interface ChannelItem {
  id: string;
  title: string | null;
  conversationType: string;
}

export function registerListChannelsTool(): void {
  registerTool(
    {
      name: "list_channels",
      description: "List all channels in the current workspace. Returns channel names and IDs.",
      input_schema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "The workspace/server ID" },
        },
        required: ["workspace_id"],
      },
    },
    async (input) => {
      const res = await graphqlClient.request<{ conversations: { items: ChannelItem[] } }>(
        CHANNELS_QUERY,
        { serverId: input.workspace_id as string },
      );
      const channels = res.conversations.items.map((ch) => ({
        id: ch.id,
        name: ch.title ?? "untitled",
        type: ch.conversationType,
      }));
      return JSON.stringify(channels);
    },
  );
}
